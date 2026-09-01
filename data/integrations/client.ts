import { errorResponseSchema, manifestSchema, successResponseSchema, type IntegrationConfigurationField, type IntegrationEvent, type IntegrationManifest } from "@peppol/types/integration";
import { createIntegrationTaskLog, updateIntegrationState, type ActivatedIntegration } from ".";
import { UserFacingError } from "@directory/utils/util";
import { createCleanUrl } from "@peppol/utils/util";
import { generateIntegrationJwt } from "./auth";
import { getMinimalTeamMembers } from "@core/data/team-members";
import { sendEmail } from "@core/lib/email";
import { getCompany } from "@peppol/data/companies";
import { getActiveSubscription } from "@peppol/data/subscriptions";
import { getTeamExtension, isPlayground } from "@peppol/data/teams";
import { canUseIntegrations } from "@peppol/utils/plan-validation";
import { IntegrationFailureNotification } from "@peppol/emails/integration-failure-notification";
import { log } from "@recommand/lib/logger";
import { getTeamNotificationT } from "@peppol/data/notification-language";

function flattenFieldsToObject(fields: IntegrationConfigurationField[]): Record<string, unknown> {
    return fields.reduce((acc, field) => {
        acc[field.id] = field.value;
        return acc;
    }, {} as Record<string, unknown>);
}

const FAILURE_EMAIL_EXCLUDED_TASKS = new Set(["HARVEST_API_ERROR"]);

function getFailureEmailTasks(failedTasks: Array<{ task: string; message: string; context?: string }>) {
    return failedTasks.filter((failedTask) => !FAILURE_EMAIL_EXCLUDED_TASKS.has(failedTask.task));
}

async function sendFailureEmailToTeam({
    integration,
    event,
    failedTasks,
}: {
    integration: ActivatedIntegration;
    event: IntegrationEvent;
    failedTasks: Array<{ task: string; message: string; context?: string }>;
}) {
    try {
        const teamExtension = await getTeamExtension(integration.teamId);
        const supportEmailAddress = teamExtension?.supportEmailAddress?.trim();

        let recipientEmails: string[];
        if (supportEmailAddress) {
            recipientEmails = [supportEmailAddress];
        } else {
            const teamMembers = await getMinimalTeamMembers(integration.teamId);
            recipientEmails = teamMembers
                .filter((member) => member.user.emailVerified)
                .map((member) => member.user.email);
        }

        if (recipientEmails.length === 0) {
            console.log("No recipients to send integration failure email to");
            return;
        }

        const t = await getTeamNotificationT(integration.teamId);
        const company = await getCompany(integration.teamId, integration.companyId);
        const companyName = company?.name || t`Unknown company`;

        const integrationName = integration.manifest.name;
        const subject = t`Integration failure: ${integrationName} for ${companyName}`;
        const email = IntegrationFailureNotification({
            t,
            integrationName,
            companyName,
            event,
            failedTasks,
        });

        for (const recipientEmail of recipientEmails) {
            try {
                await sendEmail({
                    to: recipientEmail,
                    subject,
                    email,
                });
            } catch (error) {
                console.error(`Failed to send integration failure email to ${recipientEmail}:`, error);
            }
        }
    } catch (error) {
        console.error("Failed to send integration failure emails:", error);
    }
}

export async function postToIntegration({
    integration,
    event,
    ctx,
}: {
    integration: ActivatedIntegration;
    event: IntegrationEvent;
    ctx?: { documentId?: string }
}) {
    if (!integration.configuration) {
        throw new UserFacingError("Integration configuration is not set, this is required to communicate with the integration.");
    }

    const teamIsPlayground = await isPlayground(integration.teamId);
    const subscription = await getActiveSubscription(integration.teamId);
    if (!canUseIntegrations(teamIsPlayground, subscription)) {
        throw new UserFacingError("Integrations are only available on Starter, Professional, or Enterprise plans. Please upgrade your subscription to use integrations.");
    }

    const body = JSON.stringify({
        version: integration.manifest.version,
        jwt: await generateIntegrationJwt(integration),
        auth: integration.configuration.auth,
        fields: flattenFieldsToObject(integration.configuration.fields),
        state: integration.state,
        context: {
            ...ctx,
            companyId: integration.companyId,
            teamId: integration.teamId,
        }
    });
    log(["Posting to integration", integration.manifest.url, event, JSON.stringify({...JSON.parse(body), jwt: "...", auth: {...integration.configuration.auth, token: "..."}}, null, 2)], "info");

    const response = await fetch(createCleanUrl([integration.manifest.url, event]), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body,
    });

    const responseBody = await response.text();
    log(["Response body from integration", responseBody], "info");
    const json = JSON.parse(responseBody);
    log(["Response from integration", integration.manifest.url, event, JSON.stringify(json, null, 2)], "info");

    // Ensure the version is 1.0.0
    if (json.version !== "1.0.0") {
        throw new UserFacingError(`Unsupported response version: ${json.version}. Expected version: 1.0.0`);
    }

    if (response.status !== 200) {
        const result = errorResponseSchema.safeParse(json);
        let message = "Invalid response for unsuccessful integration request";
        const failedTasks: Array<{ task: string; message: string; context?: string }> = [];
        
        if (result.success) {
            const parsedResponse = result.data;
            message = parsedResponse.error.message;
            const failedTask = {
                task: parsedResponse.error.task,
                message: parsedResponse.error.message,
                context: parsedResponse.error.context,
            };
            failedTasks.push(failedTask);
            await createIntegrationTaskLog(integration.id, event, parsedResponse.error.task, false, message, parsedResponse.error.context ?? "");
        }
        
        const emailTasks = getFailureEmailTasks(failedTasks);
        if (emailTasks.length > 0) {
            await sendFailureEmailToTeam({ integration, event, failedTasks: emailTasks });
        }
        
        log(["Error response from integration", integration.manifest.url, event, JSON.stringify(json, null, 2)], "error");
        throw new UserFacingError(message);
    }

    const result = successResponseSchema.safeParse(json);
    if (!result.success) {
        throw new UserFacingError(`Invalid response for successful integration request: ${JSON.stringify(result.error)}`);
    }
    const parsedResponse = result.data;

    // If the response contains a state, update the integration state
    if (parsedResponse.state !== null && parsedResponse.state !== undefined) {
        await updateIntegrationState(integration.teamId, integration.id, parsedResponse.state);
    }

    // If the response contains tasks, create task logs
    if (parsedResponse.tasks !== null && parsedResponse.tasks !== undefined) {
        const failedTasks: Array<{ task: string; message: string; context?: string }> = [];
        
        for (const task of parsedResponse.tasks) {
            await createIntegrationTaskLog(integration.id, event, task.task, task.success, task.message ?? "", task.context ?? "");
            
            if (!task.success) {
                failedTasks.push({
                    task: task.task,
                    message: task.message ?? "Task failed without a message",
                    context: task.context,
                });
            }
        }
        
        const emailTasks = getFailureEmailTasks(failedTasks);
        if (emailTasks.length > 0) {
            await sendFailureEmailToTeam({ integration, event, failedTasks: emailTasks });
        }
    }


    return parsedResponse;
}

export async function getIntegrationManifestFromUrl(url: string) {
    const response = await fetch(createCleanUrl([url, "manifest"]), {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new UserFacingError(`Failed to fetch integration manifest from ${url}: ${response.statusText}`);
    }

    const json = await response.json();

    return validateManifest(json);
}

export async function getIntegrationManifest(integration: ActivatedIntegration) {
    return getIntegrationManifestFromUrl(integration.manifest.url);
}

export function validateManifest(manifest: unknown): IntegrationManifest {
    const result = manifestSchema.safeParse(manifest);
    if (!result.success) {
        throw new UserFacingError(`Invalid manifest: ${JSON.stringify(result.error)}`);
    }
    return result.data;
}