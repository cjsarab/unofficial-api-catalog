export type Region = "us" | "ca" | "eu" | "ap";

export const REGIONS: ReadonlyArray<{ id: Region; label: string; baseUrl: string }> = [
  { id: "us", label: "US",           baseUrl: "https://integrate.elluciancloud.com" },
  { id: "ca", label: "Canada",       baseUrl: "https://integrate.elluciancloud.ca" },
  { id: "eu", label: "Europe",       baseUrl: "https://integrate.elluciancloud.ie" },
  { id: "ap", label: "Asia-Pacific", baseUrl: "https://integrate.elluciancloud.com.au" },
];

export function regionToBaseUrl(region: Region): string {
  const entry = REGIONS.find((r) => r.id === region);
  if (!entry) throw new Error(`unknown region: "${region}"`);
  return entry.baseUrl;
}

export function regionToAuthUrl(region: Region): string {
  return `${regionToBaseUrl(region)}/auth`;
}

export function isValidRegion(v: unknown): v is Region {
  return v === "us" || v === "ca" || v === "eu" || v === "ap";
}
