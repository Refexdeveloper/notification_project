import type { TemplateBlock } from '@/mocks/templates';

interface TemplatePreviewProps {
  blocks: TemplateBlock[];
  subject: string;
  variables: string[];
}

const resolveVariable = (text: string, vars: string[]) => {
  let result = text;
  const sampleValues: Record<string, string> = {
    Department: 'Engineering',
    'Employee Name': 'Jane Cooper',
    Status: 'Approved',
    Approver: 'Michael Thompson',
    'Form Link': 'https://kissflow.com/forms/req-48291',
    'Company Name': 'Acme Corporation',
    'Current Date': 'July 27, 2026',
    'Start Date': 'August 15, 2026',
    'Due Date': 'July 20, 2026',
    'Job Title': 'Senior Software Engineer',
    'Reporting Manager': 'David Kim',
    'Office Location': 'San Francisco',
  };
  vars.forEach((v) => {
    const placeholder = `{{${v}}}`;
    while (result.includes(placeholder)) {
      result = result.replace(placeholder, sampleValues[v] || `[${v}]`);
    }
  });
  return result;
};

function PreviewBlock({ block, variables: vars }: { block: TemplateBlock; variables: string[] }) {
  switch (block.type) {
    case 'header': {
      const level = block.level || 1;
      const content = resolveVariable(block.content, vars);
      if (level === 3) {
        return <h3 className="text-sm font-semibold text-foreground-900 mb-2">{content}</h3>;
      }
      if (level === 2) {
        return <h2 className="text-base font-semibold text-foreground-900 mb-3">{content}</h2>;
      }
      return <h1 className="text-lg font-semibold text-foreground-900 mb-3">{content}</h1>;
    }

    case 'paragraph':
      return (
        <div
          className="text-sm text-foreground-700 leading-relaxed mb-3"
          dangerouslySetInnerHTML={{
            __html: resolveVariable(block.content, vars),
          }}
        />
      );

    case 'image':
      return block.imageUrl ? (
        <div className="mb-3">
          <img src={block.imageUrl} alt={block.imageAlt || ''} className="max-w-full rounded-md" />
        </div>
      ) : null;

    case 'button':
      return (
        <div className="mb-3">
          <a
            href={resolveVariable(block.buttonUrl || '#', vars)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-primary-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg no-underline"
          >
            {resolveVariable(block.buttonText || 'Click Here', vars)}
          </a>
        </div>
      );

    case 'divider':
      return <hr className="border-background-200/70 my-3" />;

    case 'table':
      return block.tableData ? (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {block.tableData.headers.map((h, i) => (
                  <th key={i} className="border border-background-200/70 bg-background-50 px-3 py-2 text-left text-xs font-semibold text-foreground-700">
                    {resolveVariable(h, vars)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.tableData.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-background-200/70 px-3 py-2 text-xs text-foreground-600">
                      {resolveVariable(cell, vars)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null;

    case 'signature':
      return (
        <div
          className="text-sm text-foreground-700 leading-relaxed mb-3"
          dangerouslySetInnerHTML={{
            __html: resolveVariable(block.content, vars),
          }}
        />
      );

    case 'footer':
      return (
        <div
          className="text-xs text-foreground-500 leading-relaxed mb-2 opacity-70"
          dangerouslySetInnerHTML={{
            __html: resolveVariable(block.content, vars),
          }}
        />
      );

    case 'raw_html':
      return (
        <div
          className="mb-3"
          dangerouslySetInnerHTML={{ __html: block.content }}
        />
      );

    case 'spacer':
      return <div style={{ height: block.styles?.height || '16px' }} />;

    default:
      return null;
  }
}

export default function TemplatePreview({ blocks, subject, variables }: TemplatePreviewProps) {
  const resolvedSubject = resolveVariable(subject, variables);

  return (
    <div className="bg-white rounded-xl border border-background-200/70 overflow-hidden">
      <div className="bg-background-50 border-b border-background-200/70 px-4 py-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-foreground-500">
            <span className="font-medium text-foreground-600">From:</span>
            <span>notifications@enterprise.com</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-foreground-500">
            <span className="font-medium text-foreground-600">To:</span>
            <span>recipient@company.com</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-foreground-500">
            <span className="font-medium text-foreground-600">Subject:</span>
            <span className="text-foreground-800">{resolvedSubject}</span>
          </div>
        </div>
      </div>

      <div className="p-5">
        {blocks.map((block) => (
          <PreviewBlock key={block.id} block={block} variables={variables} />
        ))}
      </div>
    </div>
  );
}