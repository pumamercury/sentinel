// Text symbols also render inside native select menus, keeping the same
// iconography in display badges, filters, and editors without changing values.
export const prioritySymbols: Record<string, string> = {
  Low: '↓',
  Medium: '=',
  High: '↑',
  Critical: '‼',
};
export function priorityLabel(value: string) {
  return prioritySymbols[value] ? `${prioritySymbols[value]} ${value}` : value;
}
