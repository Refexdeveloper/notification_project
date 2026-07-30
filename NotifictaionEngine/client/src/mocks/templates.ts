export interface TemplateBlock {
  id: string;
  type: 'header' | 'paragraph' | 'image' | 'button' | 'divider' | 'table' | 'signature' | 'footer' | 'spacer' | 'raw_html';
  content: string;
  styles?: Record<string, string>;
  tableData?: { headers: string[]; rows: string[][] };
  buttonText?: string;
  buttonUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
  level?: number;
}

export interface TemplateVersion {
  id: string;
  version: number;
  author: string;
  timestamp: string;
  message: string;
  blocks: TemplateBlock[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  subject: string;
  status: 'draft' | 'published' | 'archived';
  category: string;
  appId: string;
  blocks: TemplateBlock[];
  variables: string[];
  currentVersion: number;
  versions: TemplateVersion[];
  lastModified: string;
  createdBy: string;
  createdAt: string;
}

/** Live list — no seed templates. */
export const templates: Template[] = [];

export const getTemplateById = (id: string): Template | undefined =>
  templates.find((t) => t.id === id);

export const blockTypeLabels: Record<
  TemplateBlock['type'],
  { label: string; icon: string; description: string }
> = {
  header: { label: 'Header', icon: 'ri-heading', description: 'Section heading with configurable level' },
  paragraph: { label: 'Paragraph', icon: 'ri-text', description: 'Rich text paragraph block' },
  image: { label: 'Image', icon: 'ri-image-line', description: 'Embedded image with alt text' },
  button: { label: 'Button', icon: 'ri-cursor-line', description: 'Call-to-action button with link' },
  divider: { label: 'Divider', icon: 'ri-separator', description: 'Horizontal separator line' },
  table: { label: 'Table', icon: 'ri-table-line', description: 'Data table with headers and rows' },
  signature: { label: 'Signature', icon: 'ri-pen-nib-line', description: 'Signature and sign-off block' },
  footer: { label: 'Footer', icon: 'ri-layout-bottom-line', description: 'Email footer with legal text' },
  spacer: { label: 'Spacer', icon: 'ri-space', description: 'Vertical spacing element' },
  raw_html: { label: 'Raw HTML', icon: 'ri-code-line', description: 'Custom HTML content block' },
};
