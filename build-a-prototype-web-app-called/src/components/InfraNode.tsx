import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { resourceByType } from '../data/awsResources';
import type { InfraNode } from '../types';

export function InfraNode({ data, selected }: NodeProps<InfraNode>) {
  const definition = resourceByType[data.resourceType];
  const Icon = definition.Icon;
  const isTextBoard = data.resourceType === 'textBoard';

  return (
    <div
      className={`infra-node ${isTextBoard ? 'text-board-node' : ''} ${selected ? 'selected' : ''}`}
      style={
        {
          '--node-color': definition.color,
          ...(isTextBoard ? { width: '100%', height: '100%' } : {}),
        } as CSSProperties
      }
    >
      {isTextBoard && (
        <NodeResizer
          isVisible={selected}
          minWidth={220}
          minHeight={130}
          maxWidth={620}
          maxHeight={520}
          color="#f5f5f5"
          handleClassName="text-board-resize-handle"
          lineClassName="text-board-resize-line"
        />
      )}
      {!isTextBoard && <Handle type="target" position={Position.Left} className="node-handle" />}
      {isTextBoard ? (
        <div className="text-board-content">
          <div className="text-board-title">
            <Icon size={15} />
            <strong>{data.label}</strong>
          </div>
          <p>{String(data.config.body || '')}</p>
        </div>
      ) : (
        <>
          <div className="node-glyph">
            <Icon size={18} />
          </div>
          <div className="node-copy">
            <strong>{data.label}</strong>
            <span>{definition.label}</span>
          </div>
        </>
      )}
      {!isTextBoard && <Handle type="source" position={Position.Right} className="node-handle" />}
    </div>
  );
}
