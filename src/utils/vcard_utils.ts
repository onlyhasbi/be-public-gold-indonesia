/**
 * vCard 3.0 Generator Utility
 * Generates .vcf file content from lead data for universal contact import.
 */

interface LeadData {
  nama: string;
  branch: string;
  no_telpon: string;
}

/**
 * Escape special characters in vCard text values.
 * vCard 3.0 requires escaping backslashes, semicolons, commas, and newlines.
 */
const escapeVCardValue = (value: string): string => {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
};

/**
 * Generate a single vCard 3.0 entry for a lead.
 */
const generateSingleVCard = (lead: LeadData): string => {
  const displayName = escapeVCardValue(`Cust. ${lead.nama} ${lead.branch}`);
  const org = escapeVCardValue(`Public Gold (${lead.branch})`);
  const note = escapeVCardValue(
    `Pendaftar via Agent Portal - Branch: ${lead.branch}`,
  );

  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${displayName}`,
    `N:;${displayName};;;;`,
    `TEL;TYPE=CELL:${lead.no_telpon}`,
    `ORG:${org}`,
    `NOTE:${note}`,
    "END:VCARD",
  ].join("\r\n");
};

/**
 * Generate a .vcf file content containing multiple vCard entries.
 * Each lead becomes a separate vCard within the same file.
 */
export const generateVCardFile = (leads: LeadData[]): string => {
  return leads.map(generateSingleVCard).join("\r\n");
};
