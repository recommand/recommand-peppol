import { promises as dns } from "dns";
import type { NaptrRecord } from "dns";

export function parseNaptrRegexp(regexpField: string) {
    if (!regexpField || regexpField.length < 3) {
        throw new Error("Invalid NAPTR regexp field");
    }

    const delim = regexpField[0];
    const parts = regexpField.split(delim);

    if (parts.length < 3) {
        throw new Error("NAPTR regexp has too few parts");
    }

    const pattern = parts[1] ?? "";
    const replacement = parts[2] ?? "";
    const flags = parts[3] ?? "";

    const regex = new RegExp(pattern, flags);

    return { regex, replacement, flags };
}

export function applyNaptrRegexp(record: NaptrRecord, input: string): string {
    const { regex, replacement } = parseNaptrRegexp(record.regexp);
    return input.replace(regex, replacement);
}

// A DNS server's answer that a name does not exist (NXDOMAIN), or holds no record of
// the type asked for. Every other error, such as a timeout or a failing server, is the
// absence of an answer.
const NO_SUCH_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA"]);

/**
 * The resolver every SML lookup goes through. Bounded, so a DNS server that does not
 * answer delays a lookup by seconds rather than by the minute the system defaults allow.
 */
export const smlResolver = new dns.Resolver({ timeout: 2000, tries: 2 });

type SmlResolver = Pick<InstanceType<typeof dns.Resolver>, "resolveNaptr">;

/**
 * The SMP a participant's NAPTR record points to. A record that exists but names no
 * usable SMP is `unknown`: the SML knows the participant, but not where to reach it.
 */
export type NaptrLookup = { status: "found"; smpUrl: string } | { status: "absent" } | { status: "unknown" };

function failedLookup(error: unknown): { status: "absent" } | { status: "unknown" } {
    const code = (error as { code?: string } | null)?.code ?? "";
    return { status: NO_SUCH_RECORD_CODES.has(code) ? "absent" : "unknown" };
}

export async function resolveNaptr(hostname: string, resolver: SmlResolver = smlResolver): Promise<NaptrLookup> {
    let records: NaptrRecord[];
    try {
        records = await resolver.resolveNaptr(hostname);
    } catch (error) {
        return failedLookup(error);
    }
    if (!records || records.length === 0) {
        return { status: "absent" };
    }

    // Filter for SMP service records and sort by order/preference (lower = better)
    const smpRecords = records
        .filter(r => r.service && r.service.toLowerCase().includes("meta:smp"))
        .sort((a, b) => (a.order - b.order) || (a.preference - b.preference));

    const record = smpRecords[0] ?? records[0];

    let smpUrl: string | null = null;

    if (record.regexp) {
        try {
            smpUrl = applyNaptrRegexp(record, record.replacement);
        } catch (error) { }
    }

    if (!smpUrl && record.replacement && record.replacement.trim() !== "") {
        smpUrl = record.replacement.trim();
    }

    if (!smpUrl) {
        return { status: "unknown" };
    }

    if (!smpUrl.startsWith("http://") && !smpUrl.startsWith("https://")) {
        smpUrl = `https://${smpUrl}`;
    }

    return { status: "found", smpUrl };
}
