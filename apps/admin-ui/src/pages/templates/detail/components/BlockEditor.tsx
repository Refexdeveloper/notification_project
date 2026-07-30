import { useState, useCallback, useRef } from 'react';
import type { TemplateBlock } from '@/mocks/templates';

interface BlockEditorProps {
  blocks: TemplateBlock[];
  onBlocksChange: (blocks: TemplateBlock[]) => void;
}

function BlockContent({ block, onChange }: { block: TemplateBlock; onChange: (updated: TemplateBlock) => void }) {
  const [editing, setEditing] = useState(false);

  switch (block.type) {
    case 'header':
      return (
        <div className="relative group/block">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={block.content}
                onChange={(e) => onChange({ ...block, content: e.target.value })}
                onBlur={() => setEditing(false)}
                autoFocus
                className="flex-1 text-lg font-semibold text-foreground-900 bg-background-50 border border-primary-300 rounded-md px-3 py-2 focus:outline-none"
              />
              <select
                value={block.level || 1}
                onChange={(e) => onChange({ ...block, level: parseInt(e.target.value) })}
                className="text-xs bg-background-50 border border-background-200 rounded-md px-2 py-2 focus:outline-none"
              >
                <option value={1}>H1</option>
                <option value={2}>H2</option>
                <option value={3}>H3</option>
              </select>
            </div>
          ) : (
            <div
              onClick={() => setEditing(true)}
              className="cursor-text rounded-md hover:bg-background-50/50 transition-colors px-1 -mx-1 py-1"
            >
              {block.level === 1 && <h1 className="text-lg font-semibold text-foreground-900 whitespace-pre-wrap">{block.content}</h1>}
              {block.level === 2 && <h2 className="text-base font-semibold text-foreground-900 whitespace-pre-wrap">{block.content}</h2>}
              {block.level === 3 && <h3 className="text-sm font-semibold text-foreground-900 whitespace-pre-wrap">{block.content}</h3>}
            </div>
          )}
        </div>
      );

    case 'paragraph':
      return editing ? (
        <textarea
          value={block.content}
          onChange={(e) => onChange({ ...block, content: e.target.value })}
          onBlur={() => setEditing(false)}
          autoFocus
          className="w-full text-sm text-foreground-700 bg-background-50 border border-primary-300 rounded-md px-3 py-2 focus:outline-none resize-y min-h-[60px]"
          rows={3}
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="cursor-text rounded-md hover:bg-background-50/50 transition-colors px-1 -mx-1 py-1"
          dangerouslySetInnerHTML={{ __html: block.content || 'Click to edit paragraph...' }}
        />
      );

    case 'image':
      return (
        <div className="relative group/block">
          <div className="bg-background-100 rounded-lg border border-background-200/70 p-4 text-center">
            {block.imageUrl ? (
              <div className="relative">
                <img
                  src={block.imageUrl}
                  alt={block.imageAlt || ''}
                  className="max-w-full rounded-md"
                />
                <button
                  onClick={() => onChange({ ...block, imageUrl: '', imageAlt: '' })}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover/block:opacity-100 transition-opacity cursor-pointer"
                >
                  <i className="ri-close-line text-xs text-foreground-600"></i>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="w-10 h-10 rounded-lg bg-background-200 flex items-center justify-center mx-auto">
                  <i className="ri-image-add-line text-foreground-400"></i>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <input
                    type="text"
                    placeholder="Image URL"
                    className="text-xs bg-white border border-background-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-primary-300 w-48"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onChange({ ...block, imageUrl: (e.target as HTMLInputElement).value });
                      }
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Alt text"
                    className="text-xs bg-white border border-background-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-primary-300 w-32"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onChange({ ...block, imageAlt: (e.target as HTMLInputElement).value });
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      );

    case 'button':
      return (
        <div className="relative group/block">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={block.buttonText || ''}
              onChange={(e) => onChange({ ...block, buttonText: e.target.value })}
              placeholder="Button text"
              className="text-sm font-medium bg-primary-500 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-300 text-center cursor-text"
            />
            <input
              type="text"
              value={block.buttonUrl || ''}
              onChange={(e) => onChange({ ...block, buttonUrl: e.target.value })}
              placeholder="Button URL or variable"
              className="flex-1 text-xs bg-background-50 border border-background-200 rounded-md px-2 py-2 focus:outline-none focus:border-primary-300"
            />
          </div>
        </div>
      );

    case 'divider':
      return (
        <div className="py-2">
          <hr className="border-background-200/70" />
        </div>
      );

    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            {block.tableData && (
              <>
                <thead>
                  <tr>
                    {block.tableData.headers.map((h, i) => (
                      <th
                        key={i}
                        className="border border-background-200/70 bg-background-50 px-3 py-2 text-left text-xs font-semibold text-foreground-700"
                      >
                        <input
                          type="text"
                          value={h}
                          onChange={(e) => {
                            const newHeaders = [...block.tableData!.headers];
                            newHeaders[i] = e.target.value;
                            onChange({ ...block, tableData: { ...block.tableData!, headers: newHeaders } });
                          }}
                          className="w-full bg-transparent focus:outline-none text-xs"
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.tableData.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="border border-background-200/70 px-3 py-2 text-xs text-foreground-600">
                          <input
                            type="text"
                            value={cell}
                            onChange={(e) => {
                              const newRows = [...block.tableData!.rows];
                              newRows[ri] = [...newRows[ri]];
                              newRows[ri][ci] = e.target.value;
                              onChange({ ...block, tableData: { ...block.tableData!, rows: newRows } });
                            }}
                            className="w-full bg-transparent focus:outline-none text-xs"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
          <div className="flex gap-1 mt-2">
            <button
              onClick={() => {
                if (!block.tableData) return;
                const newRows = [...block.tableData.rows, block.tableData.headers.map(() => '')];
                onChange({ ...block, tableData: { ...block.tableData, rows: newRows } });
              }}
              className="text-[11px] text-foreground-500 hover:text-foreground-700 cursor-pointer"
            >
              + Add Row
            </button>
          </div>
        </div>
      );

    case 'signature':
      return editing ? (
        <textarea
          value={block.content}
          onChange={(e) => onChange({ ...block, content: e.target.value })}
          onBlur={() => setEditing(false)}
          autoFocus
          className="w-full text-sm text-foreground-700 bg-background-50 border border-primary-300 rounded-md px-3 py-2 focus:outline-none resize-y min-h-[50px]"
          rows={2}
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="cursor-text rounded-md hover:bg-background-50/50 transition-colors px-1 -mx-1 py-1"
          dangerouslySetInnerHTML={{ __html: block.content || 'Signature block' }}
        />
      );

    case 'footer':
      return editing ? (
        <textarea
          value={block.content}
          onChange={(e) => onChange({ ...block, content: e.target.value })}
          onBlur={() => setEditing(false)}
          autoFocus
          className="w-full text-xs text-foreground-500 bg-background-50 border border-primary-300 rounded-md px-3 py-2 focus:outline-none resize-y min-h-[50px]"
          rows={3}
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="cursor-text rounded-md hover:bg-background-50/50 transition-colors px-1 -mx-1 py-1 opacity-70"
        >
          <div className="text-xs text-foreground-500" dangerouslySetInnerHTML={{ __html: block.content || 'Footer block' }} />
        </div>
      );

    case 'raw_html':
      return editing ? (
        <textarea
          value={block.content}
          onChange={(e) => onChange({ ...block, content: e.target.value })}
          onBlur={() => setEditing(false)}
          autoFocus
          className="w-full text-xs font-mono text-foreground-700 bg-background-50 border border-primary-300 rounded-md px-3 py-2 focus:outline-none resize-y min-h-[80px]"
          rows={4}
          placeholder="Enter raw HTML..."
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="cursor-text rounded-md border border-dashed border-background-300 bg-background-50/50 px-3 py-2"
        >
          {block.content ? (
            <code className="text-xs text-foreground-500 font-mono whitespace-pre-wrap">{block.content}</code>
          ) : (
            <div className="flex items-center gap-2 text-xs text-foreground-400">
              <i className="ri-code-line"></i>
              Click to add raw HTML
            </div>
          )}
        </div>
      );

    case 'spacer':
      return (
        <div
          className="h-4 bg-background-50/50 rounded cursor-ns-resize group/spacer flex items-center justify-center hover:bg-background-100 transition-colors"
          style={{ height: block.styles?.height || '16px' }}
        >
          <span className="opacity-0 group-hover/spacer:opacity-100 text-[10px] text-foreground-400 transition-opacity">
            {block.styles?.height || '16px'}
          </span>
        </div>
      );

    default:
      return null;
  }
}

export default function BlockEditor({ blocks, onBlocksChange }: BlockEditorProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      setDragOverIndex(null);
      const blockType = e.dataTransfer.getData('blockType') as TemplateBlock['type'];
      if (!blockType) return;

      const newBlock: TemplateBlock = {
        id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: blockType,
        content: blockType === 'header' ? 'New Header' : blockType === 'paragraph' ? 'New paragraph text...' : '',
        ...(blockType === 'header' ? { level: 2 } : {}),
        ...(blockType === 'button' ? { buttonText: 'Click Here', buttonUrl: '{{Form Link}}' } : {}),
        ...(blockType === 'table' ? { tableData: { headers: ['Column 1', 'Column 2'], rows: [['', '']] } } : {}),
        ...(blockType === 'spacer' ? { styles: { height: '16px' } } : {}),
      };

      const newBlocks = [...blocks];
      newBlocks.splice(index, 0, newBlock);
      onBlocksChange(newBlocks);
    },
    [blocks, onBlocksChange],
  );

  const updateBlock = useCallback(
    (index: number, updated: TemplateBlock) => {
      const newBlocks = [...blocks];
      newBlocks[index] = updated;
      onBlocksChange(newBlocks);
    },
    [blocks, onBlocksChange],
  );

  const removeBlock = useCallback(
    (index: number) => {
      const newBlocks = blocks.filter((_, i) => i !== index);
      onBlocksChange(newBlocks);
    },
    [blocks, onBlocksChange],
  );

  const moveBlock = useCallback(
    (fromIndex: number, direction: 'up' | 'down') => {
      const newBlocks = [...blocks];
      const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= newBlocks.length) return;
      [newBlocks[fromIndex], newBlocks[toIndex]] = [newBlocks[toIndex], newBlocks[fromIndex]];
      onBlocksChange(newBlocks);
    },
    [blocks, onBlocksChange],
  );

  if (blocks.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center min-h-[400px]"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          e.preventDefault();
          const blockType = e.dataTransfer.getData('blockType') as TemplateBlock['type'];
          if (!blockType) return;
          const newBlock: TemplateBlock = {
            id: `b-${Date.now()}`,
            type: blockType,
            content: blockType === 'header' ? 'New Header' : blockType === 'paragraph' ? 'New paragraph...' : '',
            ...(blockType === 'header' ? { level: 2 } : {}),
            ...(blockType === 'button' ? { buttonText: 'Click Here', buttonUrl: '{{Form Link}}' } : {}),
            ...(blockType === 'table' ? { tableData: { headers: ['Col 1', 'Col 2'], rows: [['', '']] } } : {}),
            ...(blockType === 'spacer' ? { styles: { height: '16px' } } : {}),
          };
          onBlocksChange([newBlock]);
        }}
      >
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-3">
            <i className="ri-drag-drop-line text-lg text-foreground-400"></i>
          </div>
          <p className="text-sm text-foreground-500 mb-1">Drop blocks here to start building</p>
          <p className="text-xs text-foreground-400">Drag blocks from the left panel or click to add</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 space-y-1 py-4">
      {blocks.map((block, index) => (
        <div key={block.id}>
          <div
            className={`h-1 rounded transition-all ${
              dragOverIndex === index ? 'h-8 bg-primary-100 border-2 border-dashed border-primary-300 rounded-lg' : ''
            }`}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={(e) => handleDrop(e, index)}
          />

          <div className="relative group/block-item">
            <div className="p-3 rounded-lg hover:bg-background-50/50 transition-colors">
              <BlockContent block={block} onChange={(updated) => updateBlock(index, updated)} />
            </div>

            <div className="absolute -right-1 top-1 flex items-center gap-0.5 opacity-0 group-hover/block-item:opacity-100 transition-opacity">
              <button
                onClick={() => moveBlock(index, 'up')}
                disabled={index === 0}
                className="w-6 h-6 rounded-md bg-white border border-background-200 flex items-center justify-center hover:bg-background-50 transition-colors cursor-pointer disabled:opacity-30"
              >
                <i className="ri-arrow-up-s-line text-xs text-foreground-500"></i>
              </button>
              <button
                onClick={() => moveBlock(index, 'down')}
                disabled={index === blocks.length - 1}
                className="w-6 h-6 rounded-md bg-white border border-background-200 flex items-center justify-center hover:bg-background-50 transition-colors cursor-pointer disabled:opacity-30"
              >
                <i className="ri-arrow-down-s-line text-xs text-foreground-500"></i>
              </button>
              <button
                onClick={() => removeBlock(index)}
                className="w-6 h-6 rounded-md bg-white border border-red-200 flex items-center justify-center hover:bg-red-50 transition-colors cursor-pointer"
              >
                <i className="ri-delete-bin-line text-xs text-red-500"></i>
              </button>
            </div>
          </div>
        </div>
      ))}

      <div
        className={`h-1 rounded transition-all ${
          dragOverIndex === blocks.length ? 'h-8 bg-primary-100 border-2 border-dashed border-primary-300 rounded-lg' : ''
        }`}
        onDragOver={(e) => handleDragOver(e, blocks.length)}
        onDragLeave={() => setDragOverIndex(null)}
        onDrop={(e) => handleDrop(e, blocks.length)}
      />
    </div>
  );
}