import { Buffer } from 'node:buffer';
import {
  defaultFields,
  lockedFields,
  fieldTypeOptions,
  statusCategory,
} from './field-schema.mjs';
const str = (v, max = 500) => {
  if (typeof v !== 'string' || v.length > max)
    throw Error('Invalid text value.');
  return v.trim();
};
export function validateFieldConfig(value) {
  if (!Array.isArray(value) || value.length > 60)
    throw Error('Use up to 60 fields.');
  value = upgradeFields(value);
  const keys = new Set();
  const clean = value.map((f) => {
    if (!f || typeof f.key !== 'string' || keys.has(f.key))
      throw Error('Invalid or duplicate field key.');
    keys.add(f.key);
    const base = defaultFields.find((b) => b.key === f.key);
    if (!base && !/^custom_[a-zA-Z0-9_-]{1,80}$/.test(f.key))
      throw Error('Invalid custom field key.');
    if (
      !['text', 'textarea', 'number', 'date', 'select'].includes(f.type) ||
      typeof f.enabled !== 'boolean' ||
      typeof f.required !== 'boolean'
    )
      throw Error('Invalid field settings.');
    const label = str(f.label, 80);
    if (!label) throw Error('Field label is required.');
    if (!Array.isArray(f.options) || f.options.length > 100)
      throw Error('Invalid options.');
    const options = [
      ...new Set(
        f.options
          .map((o) => str(o, f.key === 'environment' ? 500 : 200))
          .filter(Boolean),
      ),
    ];
    if (
      f.type === 'select' &&
      !options.length &&
      (f.key !== 'environment' || f.required)
    )
      throw Error('Select fields need options.');
    if (base && !fieldTypeOptions(base).includes(f.type))
      throw Error(`${base.label} uses a fixed field type.`);
    if (lockedFields.includes(f.key) && (!f.enabled || !f.required))
      throw Error(
        'Title, project, status and priority must stay enabled and required.',
      );
    const issueTypes = f.issueTypes ?? base?.issueTypes ?? [];
    if (
      !Array.isArray(issueTypes) ||
      issueTypes.some((type) => typeof type !== 'string' || type.length > 200)
    )
      throw Error('Invalid issue type scope.');
    const categories = {};
    if (f.key === 'status')
      for (const option of options) {
        const category = f.categories?.[option] ?? statusCategory(option);
        if (!['open', 'in-progress', 'completed'].includes(category))
          throw Error('Invalid status category.');
        categories[option] = category;
      }
    return {
      key: f.key,
      label,
      type: f.type,
      enabled: f.enabled,
      required: f.required,
      options,
      builtin: !!base,
      issueTypes:
        lockedFields.includes(f.key) || f.key === 'issueType' ? [] : issueTypes,
      ...(f.key === 'status' ? { categories } : {}),
    };
  });
  if (defaultFields.some((f) => !keys.has(f.key)))
    throw Error('Hide built-in fields instead of removing them.');
  return clean;
}
export function upgradeFields(fields) {
  return [
    ...fields.map((f) => ({
      ...f,
      ...(f.key === 'fixVersion' && /^fix\s+version$/i.test(f.label?.trim())
        ? { label: 'Fix version' }
        : {}),
      ...(f.key === 'environment'
        ? {
            type: 'select',
            label:
              f.label === 'Environment / browser / device'
                ? 'Environment'
                : f.label,
          }
        : {}),
      issueTypes:
        f.issueTypes ??
        defaultFields.find((b) => b.key === f.key)?.issueTypes ??
        [],
    })),
    ...defaultFields.filter((base) => !fields.some((f) => f?.key === base.key)),
  ];
}
export function validateImage(image) {
  if (!image) return '';
  if (typeof image !== 'string' || image.length > 2_800_000)
    throw Error('Project image must be at most 2 MB.');
  const m = image.match(
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/,
  );
  if (!m) throw Error('Use a PNG, JPEG or WebP image.');
  const b = Buffer.from(m[2], 'base64');
  if (
    b.length > 2_000_000 ||
    !(
      (m[1] === 'png' &&
        b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') ||
      (m[1] === 'jpeg' && b[0] === 255 && b[1] === 216 && b[2] === 255) ||
      (m[1] === 'webp' &&
        b.subarray(0, 4).toString() === 'RIFF' &&
        b.subarray(8, 12).toString() === 'WEBP')
    )
  )
    throw Error('Invalid image file.');
  return image;
}
export function projectData(p) {
  const name = str(p.name);
  if (!name) throw Error('Project name is required.');
  return {
    name,
    description: str(p.description ?? '', 10000),
    icon: str(p.icon ?? '', 16),
    image: validateImage(p.image ?? ''),
  };
}
