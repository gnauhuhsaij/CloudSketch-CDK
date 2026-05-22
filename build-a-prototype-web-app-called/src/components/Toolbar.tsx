import { Download, FileCode2, GitBranch, Save, ShieldCheck } from 'lucide-react';
import { useRef } from 'react';

type ToolbarProps = {
  onValidate: () => void;
  onGenerate: () => void;
  onLoadExample: () => void;
  onLoadStackFile: (file: File) => void | Promise<void>;
  onSaveProject: () => void;
};

export function Toolbar({
  onValidate,
  onGenerate,
  onLoadExample,
  onLoadStackFile,
  onSaveProject,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="toolbar">
      <div className="brand">
        <div className="brand-mark">IC</div>
        <div>
          <h1>InfraCanvas</h1>
          <p>Visual AWS CDK template builder</p>
        </div>
      </div>
      <nav className="toolbar-actions">
        <button type="button" onClick={onSaveProject}>
          <Save size={17} />
          Save
        </button>
        <button type="button" onClick={onValidate}>
          <ShieldCheck size={17} />
          Validate
        </button>
        <button type="button" className="primary" onClick={onGenerate}>
          <Download size={17} />
          Generate CDK
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          <FileCode2 size={17} />
          Load stack.ts
        </button>
        <input
          ref={fileInputRef}
          className="visually-hidden-file"
          type="file"
          hidden
          accept=".ts,text/typescript,text/plain"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void onLoadStackFile(file);
            event.currentTarget.value = '';
          }}
        />
        <button type="button" onClick={onLoadExample}>
          <GitBranch size={17} />
          Sample workflow
        </button>
      </nav>
    </header>
  );
}
