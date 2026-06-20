export function getSecurityColor(security: number | null): string {
  if (security === null) return "#6b7280";
  if (security >= 1.0) return "#2C75E1";
  if (security >= 0.9) return "#399AEB";
  if (security >= 0.8) return "#4ECEF8";
  if (security >= 0.7) return "#60DBA3";
  if (security >= 0.6) return "#71E754";
  if (security >= 0.5) return "#F5FF83";
  if (security >= 0.4) return "#DC6C06";
  if (security >= 0.3) return "#CE440F";
  if (security >= 0.2) return "#BB1116";
  if (security >= 0.1) return "#731F1F";
  return "#8D3163";
}
