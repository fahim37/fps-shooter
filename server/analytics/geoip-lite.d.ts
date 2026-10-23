declare module "geoip-lite" {
  export interface Lookup {
    range: [number, number];
    country: string;
    region: string;
    eu: "0" | "1";
    timezone: string;
    city: string;
    ll: [number, number];
    metro: number;
    area: number;
  }
  export function lookup(ip: string): Lookup | null;
  const geoip: { lookup: typeof lookup };
  export default geoip;
}
