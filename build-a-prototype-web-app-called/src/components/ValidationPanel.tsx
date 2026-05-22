import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { ValidationIssue } from '../types';

type ValidationPanelProps = {
  issues: ValidationIssue[];
  onIssueSelect?: (issue: ValidationIssue) => void;
};

export function ValidationPanel({ issues, onIssueSelect }: ValidationPanelProps) {
  const [isHidden, setIsHidden] = useState(false);
  const [panelHeight, setPanelHeight] = useState(210);
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const visibleIssues = issues.filter((issue) => issue.severity !== 'info');

  function startResize(event: ReactMouseEvent<HTMLDivElement>) {
    if (isHidden) return;

    const startY = event.clientY;
    const startHeight = panelHeight;
    const maxHeight = Math.round(window.innerHeight * 0.58);

    function onMouseMove(moveEvent: MouseEvent) {
      const nextHeight = startHeight + startY - moveEvent.clientY;
      setPanelHeight(Math.min(Math.max(nextHeight, 132), maxHeight));
    }

    function onMouseUp() {
      document.body.classList.remove('is-resizing-validation');
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    document.body.classList.add('is-resizing-validation');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  return (
    <section className={`validation-panel ${isHidden ? 'hidden' : ''}`} style={{ height: isHidden ? 42 : panelHeight }}>
      {!isHidden && <div className="validation-resize-handle" onMouseDown={startResize} />}
      <div className="validation-header">
        <div>
          <p className="eyebrow">Validation</p>
          <h2>{errors ? `${errors} error${errors > 1 ? 's' : ''}` : warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : 'Graph looks deployable'}</h2>
        </div>
        <div className="validation-counts">
          {!isHidden && <span>{errors} errors</span>}
          {!isHidden && <span>{warnings} warnings</span>}
          <button
            type="button"
            className="expand-button icon-only"
            aria-label={isHidden ? 'Show validation panel' : 'Hide validation panel'}
            onClick={() => setIsHidden((current) => !current)}
          >
            {isHidden ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
        </div>
      </div>
      {!isHidden && (
        <div className="issue-list">
          {visibleIssues.length === 0 ? (
            <article className="issue empty-validation">
              <strong>No blocking findings</strong>
              <span>Warnings and errors will appear here after validation. Informational mappings stay in the inspector for selected edges.</span>
            </article>
          ) : visibleIssues.map((issue) => (
            <article
              className={`issue ${issue.severity} ${issue.edgeId ? 'clickable' : ''}`}
              key={issue.id}
              role={issue.edgeId ? 'button' : undefined}
              tabIndex={issue.edgeId ? 0 : undefined}
              onClick={() => onIssueSelect?.(issue)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onIssueSelect?.(issue);
                }
              }}
            >
              <strong>{issue.severity}</strong>
              <span>{issue.message}</span>
              {issue.cdkHint && <code>{issue.cdkHint}</code>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
