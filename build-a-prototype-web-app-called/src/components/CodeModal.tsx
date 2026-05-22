import { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { Copy, Download, X } from 'lucide-react';

type CodeModalProps = {
  files: Record<string, string>;
  onClose: () => void;
};

export function CodeModal({ files, onClose }: CodeModalProps) {
  const fileNames = useMemo(() => Object.keys(files), [files]);
  const [activeFile, setActiveFile] = useState(fileNames[0]);
  const [status, setStatus] = useState('');

  async function copyAll() {
    const payload = fileNames.map((name) => `// ${name}\n${files[name]}`).join('\n\n');
    await navigator.clipboard.writeText(payload);
    setStatus('Copied all files to clipboard.');
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(files, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'infracanvas-cdk-project.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadZip() {
    const zip = new JSZip();
    fileNames.forEach((name) => zip.file(name, files[name]));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'infracanvas-cdk-project.zip';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="code-modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Generated CDK Project</p>
            <h2>TypeScript scaffold</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close modal" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="file-tabs">
          {fileNames.map((name) => (
            <button type="button" className={activeFile === name ? 'active' : ''} key={name} onClick={() => setActiveFile(name)}>
              {name}
            </button>
          ))}
        </div>
        <pre className="code-view">
          <code>{files[activeFile]}</code>
        </pre>
        <div className="modal-footer">
          <span>{status}</span>
          <div>
            <button type="button" onClick={copyAll}>
              <Copy size={16} />
              Copy all files
            </button>
            <button type="button" onClick={downloadJson}>
              <Download size={16} />
              Download JSON
            </button>
            <button type="button" className="primary" onClick={downloadZip}>
              <Download size={16} />
              Download Project ZIP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
