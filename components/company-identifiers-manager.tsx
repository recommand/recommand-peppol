import { useState, useEffect } from "react";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@core/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { AsyncButton } from "@core/components/async-button";
import { toast } from "@core/components/ui/sonner";
import { Plus, Edit, Trash2, X, Check, ArrowRightLeft } from "lucide-react";
import { rc } from "@recommand/lib/client";
import type { CompanyIdentifiers } from "@peppol/api/companies/identifiers";
import type { CompanyIdentifier } from "@peppol/data/company-identifiers";
import type { ParticipantMigration } from "@peppol/data/participant-migrations";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { useTranslation } from "@core/hooks/use-translation";

const client = rc<CompanyIdentifiers>("peppol");

type CompanyIdentifiersManagerProps = {
    teamId: string;
    companyId: string;
    /** Migration keys only apply to recipient registrations; a send-only company gets no migration controls. */
    isSmpRecipient?: boolean;
    /**
     * Whether the company's identifiers are currently registered on the SMP. Until then, for
     * example while a strict team's identity check is still open, an identifier in this list
     * may still be published by another provider and can be taken over with a migration key.
     * Once published here there is nothing to migrate, so the per-identifier action is hidden.
     */
    publishedOnSmp?: boolean;
};

type IdentifierFormData = {
    scheme: string;
    identifier: string;
    migrationKey: string;
};

type MigrationState = Pick<ParticipantMigration, "id" | "direction" | "status" | "errorMessage">;

const emptyForm: IdentifierFormData = { scheme: "", identifier: "", migrationKey: "" };

const SCHEME_LABELS: Record<string, string> = {
    "0225": "0225 (France, SIREN)",
};

function schemeLabel(scheme: string): string {
    return SCHEME_LABELS[scheme] ?? scheme;
}

export function CompanyIdentifiersManager({ teamId, companyId, isSmpRecipient = true, publishedOnSmp = true }: CompanyIdentifiersManagerProps) {
    const { t, language } = useTranslation();
    const [identifiers, setIdentifiers] = useState<CompanyIdentifier[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdding, setIsAdding] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<IdentifierFormData>(emptyForm);
    const [editFormData, setEditFormData] = useState<IdentifierFormData>(emptyForm);
    // The identifier whose migration key form is open, and the key typed into it.
    const [migratingId, setMigratingId] = useState<string | null>(null);
    const [migrationKey, setMigrationKey] = useState("");
    // The newest migration per identifier, so a stored or refused key stays visible.
    const [latestMigrations, setLatestMigrations] = useState<Record<string, MigrationState>>({});
    // The schemes this company's Peppol registration accepts; null when any scheme goes.
    const [supportedSchemes, setSupportedSchemes] = useState<string[] | null>(null);
    const restricted = supportedSchemes !== null;
    const defaultScheme = supportedSchemes?.length === 1 ? supportedSchemes[0] : "";
    // A restricted scheme list means a partner SMP publishes this company, and partner SMPs have no migration keys.
    const canMigrate = isSmpRecipient && !restricted;
    // A new identifier is never ours yet; an existing one only needs a key while the company is not published.
    const canMigrateExisting = canMigrate && !publishedOnSmp;

    useEffect(() => {
        fetchIdentifiers();
        fetchSupportedSchemes();
    }, [teamId, companyId]);

    const fetchSupportedSchemes = async () => {
        try {
            const response = await client[":teamId"]["companies"][":companyId"]["identifiers"]["schemes"].$get({
                param: { teamId, companyId },
            });
            const json = await response.json();
            if (json.success) {
                setSupportedSchemes(json.supportedSchemes);
            }
        } catch (error) {
            console.error("Error fetching supported identifier schemes:", error);
        }
    };

    const fetchIdentifiers = async () => {
        try {
            setIsLoading(true);
            const response = await client[":teamId"]["companies"][":companyId"]["identifiers"].$get({
                param: { teamId, companyId },
            });
            const json = await response.json();

            if (!json.success) {
                toast.error(stringifyActionFailure(json.errors));
                return;
            }

            const loaded = (json.identifiers || []).map(id => ({
                ...id,
                createdAt: new Date(id.createdAt),
                updatedAt: new Date(id.updatedAt),
            }));
            setIdentifiers(loaded);
            fetchLatestMigrations(loaded.map((identifier) => identifier.id));
        } catch (error) {
            console.error("Error fetching identifiers:", error);
            toast.error(t`Failed to load company identifiers: ${error}`);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchLatestMigrations = async (identifierIds: string[]) => {
        const entries = await Promise.all(identifierIds.map(async (identifierId): Promise<[string, MigrationState] | null> => {
            try {
                const response = await client[":teamId"]["companies"][":companyId"]["identifiers"][":identifierId"]["migrations"].$get({
                    param: { teamId, companyId, identifierId },
                });
                const json = await response.json();
                const latest = json.success ? json.migrations[0] : undefined;
                return latest ? [identifierId, latest] : null;
            } catch (error) {
                console.error("Error fetching identifier migrations:", error);
                return null;
            }
        }));
        setLatestMigrations(Object.fromEntries(entries.filter((entry): entry is [string, MigrationState] => entry !== null)));
    };

    const handleMigrate = async (identifierId: string) => {
        if (!migrationKey.trim()) {
            toast.error(t`Migration key is required`);
            return;
        }

        try {
            setIsSubmitting(true);
            const response = await client[":teamId"]["companies"][":companyId"]["identifiers"][":identifierId"]["migration"].$post({
                param: { teamId, companyId, identifierId },
                json: { migrationKey: migrationKey.trim() },
            });

            const json = await response.json();
            if (!json.success) {
                throw new Error(stringifyActionFailure(json.errors));
            }

            if (json.migration.status === "completed") {
                toast.success(t`Identifier moved to Recommand`);
            } else {
                toast.success(t`Migration key stored. It is used as soon as the company is verified and registered.`);
            }
            setMigratingId(null);
            setMigrationKey("");
        } catch (error) {
            toast.error(t`Failed to migrate identifier: ${error}`);
        } finally {
            setIsSubmitting(false);
            fetchIdentifiers();
        }
    };

    const startMigrate = (identifierId: string) => {
        setEditingId(null);
        setMigratingId(identifierId);
        setMigrationKey("");
    };

    const cancelMigrate = () => {
        setMigratingId(null);
        setMigrationKey("");
    };

    const migrationStatus = (identifierId: string) => {
        const latest = latestMigrations[identifierId];
        if (!latest || latest.direction !== "inbound") {
            return null;
        }
        if (latest.status === "pending") {
            return <div className="text-xs text-amber-700 dark:text-amber-400">{t`Migration key stored and waiting for the company's registration.`}</div>;
        }
        if (latest.status === "failed") {
            return <div className="text-xs text-destructive">{t`Migration failed: ${latest.errorMessage ?? ""}`}</div>;
        }
        return null;
    };

    const handleAdd = async () => {
        if (!formData.scheme.trim()) {
            toast.error(t`Scheme is required`);
            return;
        }
        if (!formData.identifier.trim()) {
            toast.error(t`Identifier is required`);
            return;
        }

        try {
            setIsSubmitting(true);
            const key = formData.migrationKey.trim();
            const response = await client[":teamId"]["companies"][":companyId"]["identifiers"].$post({
                param: { teamId, companyId },
                json: {
                    scheme: formData.scheme,
                    identifier: formData.identifier,
                    ...(canMigrate && key ? { migrationKey: key } : {}),
                },
            });

            const json = await response.json();
            if (!json.success) {
                throw new Error(stringifyActionFailure(json.errors));
            }

            toast.success(t`Identifier added successfully`);
            setFormData(emptyForm);
            setIsAdding(false);
        } catch (error) {
            toast.error(t`Failed to add identifier: ${error}`);
        } finally {
            setIsSubmitting(false);
            fetchIdentifiers();
        }
    };

    const handleEdit = async () => {
        if (!editingId) {
            toast.error(t`No identifier selected for editing`);
            return;
        }
        if (!editFormData.scheme.trim()) {
            toast.error(t`Scheme is required`);
            return;
        }
        if (!editFormData.identifier.trim()) {
            toast.error(t`Identifier is required`);
            return;
        }

        try {
            setIsSubmitting(true);
            const response = await client[":teamId"]["companies"][":companyId"]["identifiers"][":identifierId"].$put({
                param: { teamId, companyId, identifierId: editingId },
                json: { scheme: editFormData.scheme, identifier: editFormData.identifier },
            });

            const json = await response.json();
            if (!json.success) {
                throw new Error(stringifyActionFailure(json.errors));
            }

            toast.success(t`Identifier updated successfully`);
            setEditingId(null);
            setEditFormData(emptyForm);
        } catch (error) {
            toast.error(t`Failed to update identifier: ${error}`);
        } finally {
            setIsSubmitting(false);
            fetchIdentifiers();
        }
    };

    const handleDelete = async (identifierId: string) => {
        try {
            const response = await client[":teamId"]["companies"][":companyId"]["identifiers"][":identifierId"].$delete({
                param: { teamId, companyId, identifierId },
            });

            const json = await response.json();
            if (!json.success) {
                throw new Error(stringifyActionFailure(json.errors));
            }

            toast.success(t`Identifier deleted successfully`);
        } catch (error) {
            toast.error(t`Failed to delete identifier: ${error}`);
        } finally {
            fetchIdentifiers();
        }
    };

    const startEdit = (identifier: CompanyIdentifier) => {
        setMigratingId(null);
        setEditingId(identifier.id);
        setEditFormData({
            scheme: identifier.scheme,
            identifier: identifier.identifier,
            migrationKey: "",
        });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditFormData(emptyForm);
    };

    const cancelAdd = () => {
        setIsAdding(false);
        setFormData(emptyForm);
    };

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>{t`Company Identifiers`}</CardTitle>
                    <CardDescription>{t`Manage your company identifiers`}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center h-32">
                        <div className="text-center text-muted-foreground">{t`Loading...`}</div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <CardTitle>{t`Company Identifiers`}</CardTitle>
                        <CardDescription className="text-balance">
                            {t`Identifiers are used to identify your company in the Peppol network.`}
                        </CardDescription>
                    </div>
                    {!isAdding && (
                        <Button onClick={() => { setFormData({ ...emptyForm, scheme: defaultScheme }); setIsAdding(true); }} size="sm">
                            <Plus className="h-4 w-4" />
                            {t`Add Identifier`}
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Add Form */}
                {isAdding && (
                    <div className="p-4 border rounded-lg bg-muted/50">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="add-scheme">{t`Scheme`}</Label>
                                {restricted ? (
                                    <Select value={formData.scheme} onValueChange={(scheme) => setFormData({ ...formData, scheme })}>
                                        <SelectTrigger id="add-scheme" className="w-full">
                                            <SelectValue placeholder={t`Select a scheme`} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {supportedSchemes.map((scheme) => (
                                                <SelectItem key={scheme} value={scheme}>{schemeLabel(scheme)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Input
                                        id="add-scheme"
                                        placeholder={t`e.g., 0208 (Belgium)`}
                                        value={formData.scheme}
                                        onChange={(e) => setFormData({ ...formData, scheme: e.target.value })}
                                    />
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="add-identifier">{t`Identifier`}</Label>
                                <Input
                                    id="add-identifier"
                                    placeholder={t`e.g., 1012081766`}
                                    value={formData.identifier}
                                    onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                                />
                            </div>
                        </div>

                        <p className="text-xs text-muted-foreground mt-2">
                            {restricted
                                ? t`The Peppol registration of this company only accepts the schemes listed above.`
                                : t`Common schemes: 0208 (Belgium), 0106 (Netherlands), 0225 (France)`}
                        </p>
                        {canMigrate && (
                            <div className="space-y-2 mt-4">
                                <Label htmlFor="add-migration-key">{t`Migration key (optional)`}</Label>
                                <Input
                                    id="add-migration-key"
                                    placeholder="Ab12$#xyZ9!kLm"
                                    value={formData.migrationKey}
                                    autoComplete="off"
                                    onChange={(e) => setFormData({ ...formData, migrationKey: e.target.value })}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t`Moving this identifier from another Peppol provider? Ask them for a migration key and enter it here. The identifier then moves to Recommand without a gap in reception.`}
                                </p>
                            </div>
                        )}
                        <div className="flex gap-2 mt-4 justify-end">
                            <AsyncButton onClick={handleAdd} size="sm" disabled={isSubmitting}>
                                <Check className="h-4 w-4" />
                                {t`Add`}
                            </AsyncButton>
                            <Button onClick={cancelAdd} variant="outline" size="sm" disabled={isSubmitting}>
                                <X className="h-4 w-4" />
                                {t`Cancel`}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Identifiers List */}
                <div className="space-y-2">
                    {identifiers.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <p>{t`No identifiers found`}</p>
                            <p className="text-sm">{t`Add your first identifier to get started`}</p>
                        </div>
                    ) : (
                        identifiers.map((identifier) => (
                            <div key={identifier.id} className="flex items-center justify-between p-3 border rounded-lg gap-4">
                                {editingId === identifier.id ? (
                                    // Edit Form
                                    <div className="flex-1 space-y-4">
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="space-y-1">
                                                <Label htmlFor={`edit-scheme-${identifier.id}`} className="text-xs">{t`Scheme`}</Label>
                                                {restricted ? (
                                                    <Select value={editFormData.scheme} onValueChange={(scheme) => setEditFormData({ ...editFormData, scheme })}>
                                                        <SelectTrigger id={`edit-scheme-${identifier.id}`} className="w-full">
                                                            <SelectValue placeholder={t`Select a scheme`} />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {[...supportedSchemes, ...(supportedSchemes.includes(identifier.scheme) ? [] : [identifier.scheme])].map((scheme) => (
                                                                <SelectItem key={scheme} value={scheme}>{schemeLabel(scheme)}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <Input
                                                        id={`edit-scheme-${identifier.id}`}
                                                        value={editFormData.scheme}
                                                        onChange={(e) => setEditFormData({ ...editFormData, scheme: e.target.value })}
                                                        size={1}
                                                    />
                                                )}
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor={`edit-identifier-${identifier.id}`} className="text-xs">{t`Identifier`}</Label>
                                                <Input
                                                    id={`edit-identifier-${identifier.id}`}
                                                    value={editFormData.identifier}
                                                    onChange={(e) => setEditFormData({ ...editFormData, identifier: e.target.value })}
                                                    size={1}
                                                />
                                            </div>
                                        </div>
                                        <div className="flex gap-2 justify-end">
                                            <AsyncButton onClick={handleEdit} size="sm" variant="default" disabled={isSubmitting}>
                                                <Check className="h-4 w-4" />
                                                {t`Save Changes`}
                                            </AsyncButton>
                                            <Button onClick={cancelEdit} size="sm" variant="outline" disabled={isSubmitting}>
                                                <X className="h-4 w-4" />
                                                {t`Cancel Edit`}
                                            </Button>
                                        </div>
                                    </div>
                                ) : migratingId === identifier.id ? (
                                    // Migration key form
                                    <div className="flex-1 space-y-3">
                                        <div className="font-medium">{identifier.scheme}:{identifier.identifier}</div>
                                        <div className="space-y-1">
                                            <Label htmlFor={`migration-key-${identifier.id}`} className="text-xs">{t`Migration key`}</Label>
                                            <Input
                                                id={`migration-key-${identifier.id}`}
                                                placeholder="Ab12$#xyZ9!kLm"
                                                value={migrationKey}
                                                autoComplete="off"
                                                onChange={(e) => setMigrationKey(e.target.value)}
                                                size={1}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                {t`Enter the migration key your current Peppol provider issued for this identifier. The registration moves to Recommand without a gap in reception.`}
                                            </p>
                                        </div>
                                        <div className="flex gap-2 justify-end">
                                            <AsyncButton onClick={() => handleMigrate(identifier.id)} size="sm" disabled={isSubmitting}>
                                                <ArrowRightLeft className="h-4 w-4" />
                                                {t`Move to Recommand`}
                                            </AsyncButton>
                                            <Button onClick={cancelMigrate} size="sm" variant="outline" disabled={isSubmitting}>
                                                <X className="h-4 w-4" />
                                                {t`Cancel`}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    // Display
                                    <div className="flex-1">
                                        <div className="font-medium">{identifier.scheme}:{identifier.identifier}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {t`Updated: ${new Date(identifier.updatedAt).toLocaleDateString(language)}`}
                                        </div>
                                        {restricted && !supportedSchemes.includes(identifier.scheme) && (
                                            <div className="text-xs text-destructive">
                                                {t`This scheme is not accepted by the Peppol registration of this company. Remove or change this identifier.`}
                                            </div>
                                        )}
                                        {migrationStatus(identifier.id)}
                                    </div>
                                )}

                                {editingId === identifier.id || migratingId === identifier.id ? null : (
                                    <div className="flex gap-2">
                                        {canMigrateExisting && (
                                            <Button
                                                onClick={() => startMigrate(identifier.id)}
                                                size="sm"
                                                variant="outline"
                                                title={t`Migrate to Recommand`}
                                            >
                                                <ArrowRightLeft className="h-4 w-4" />
                                            </Button>
                                        )}
                                        <Button
                                            onClick={() => startEdit(identifier)}
                                            size="sm"
                                            variant="outline"
                                        >
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                        <AsyncButton
                                            onClick={() => handleDelete(identifier.id)}
                                            size="sm"
                                            variant="destructive"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </AsyncButton>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
