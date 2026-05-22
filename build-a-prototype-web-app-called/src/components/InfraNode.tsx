import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { resourceByType } from '../data/awsResources';
import type { InfraNode } from '../types';

export function InfraNode({ data, selected }: NodeProps<InfraNode>) {
  const definition = resourceByType[data.resourceType];
  const Icon = definition.Icon;

  return (
    <div className={`infra-node ${selected ? 'selected' : ''}`} style={{ '--node-color': definition.color } as CSSProperties}>
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div className="node-glyph">
        <Icon size={18} />
      </div>
      <div className="node-copy">
        <strong>{data.label}</strong>
        <span>{definition.label}</span>
      </div>
      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  );
}
