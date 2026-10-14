export type FieldDefinition = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'date';
  required: boolean;
  options: string[];
  enabled: boolean;
  builtin: boolean;
  issueTypes?: string[];
  categories?: Record<string, 'open' | 'in-progress' | 'completed'>;
};
export function fieldApplies(field: FieldDefinition, type?: string): boolean;
export function fieldLabel(field: FieldDefinition, type?: string): string;
export function statusCategory(
  status: string,
  fields?: FieldDefinition[],
): 'open' | 'in-progress' | 'completed';
export const defaultFields: FieldDefinition[];
export const lockedFields: string[];
export function fieldTypeOptions(
  field: FieldDefinition,
): FieldDefinition['type'][];
