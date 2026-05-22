import {
  Background,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  type XYPosition,
} from '@xyflow/react';
import { Expand, LocateFixed, Lock, Minus, Plus, Unlock } from 'lucide-react';
import type { DragEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { InfraNode } from './InfraNode';
import { awsResources, resourceByType } from '../data/awsResources';
import type { InfraEdge, InfraNode as InfraNodeType } from '../types';

const nodeTypes = { infraNode: InfraNode };

type CanvasProps = {
  nodes: InfraNodeType[];
  edges: InfraEdge[];
  selectedNodeId?: string;
  selectedEdgeId?: string;
  onNodesChange: OnNodesChange<InfraNodeType>;
  onEdgesChange: OnEdgesChange<InfraEdge>;
  onConnect: OnConnect;
  onAddResource: (type: string, position: XYPosition) => void;
  onDropResource: (type: string, event: DragEvent<HTMLDivElement>) => void;
  onSelectionChange: (selection: { nodes: InfraNodeType[]; edges: InfraEdge[] }) => void;
  onFocusChange: (selection: { nodes: InfraNodeType[]; edges: InfraEdge[] }) => void;
};

export function Canvas({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onAddResource,
  onDropResource,
  onSelectionChange,
  onFocusChange,
}: CanvasProps) {
  const { fitView, screenToFlowPosition, setCenter, zoomIn, zoomOut } = useReactFlow<InfraNodeType, InfraEdge>();
  const shellRef = useRef<HTMLElement>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);

  useEffect(() => {
    if (selectedNode) {
      setCenter(selectedNode.position.x + 99, selectedNode.position.y + 32, { duration: 420, zoom: 1 });
      return;
    }

    if (selectedEdge) {
      const source = nodes.find((node) => node.id === selectedEdge.source);
      const target = nodes.find((node) => node.id === selectedEdge.target);

      if (source && target) {
        setCenter((source.position.x + target.position.x) / 2 + 99, (source.position.y + target.position.y) / 2 + 32, {
          duration: 420,
          zoom: 1,
        });
      }
    }
  }, [nodes, selectedEdge, selectedEdgeId, selectedNode, selectedNodeId, setCenter]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (!shellRef.current) return;
    if (isFullscreen) {
      setIsFullscreen(false);
      if (document.fullscreenElement === shellRef.current) await document.exitFullscreen();
      return;
    }
    setIsFullscreen(true);
    await shellRef.current.requestFullscreen().catch(() => {
      // Keep the CSS fullscreen fallback active if the browser blocks the Fullscreen API.
    });
  }

  function addResourceFromPalette(type: string) {
    const bounds = shellRef.current?.getBoundingClientRect();
    const position = screenToFlowPosition({
      x: (bounds?.left || 0) + (bounds?.width || window.innerWidth) / 2,
      y: (bounds?.top || 0) + (bounds?.height || window.innerHeight) / 2,
    });
    onAddResource(type, position);
    setIsPaletteOpen(false);
  }

  return (
    <main className={`canvas-shell ${isFullscreen ? 'canvas-shell-fullscreen' : ''}`} ref={shellRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange as (changes: NodeChange<InfraNodeType>[]) => void}
        onEdgesChange={onEdgesChange as (changes: EdgeChange<InfraEdge>[]) => void}
        onConnect={(connection: Connection) => onConnect(connection)}
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={(_, node) => onFocusChange({ nodes: [node], edges: [] })}
        onEdgeDoubleClick={(_, edge) => onFocusChange({ nodes: [], edges: [edge] })}
        onPaneClick={() => {
          onSelectionChange({ nodes: [], edges: [] });
          onFocusChange({ nodes: [], edges: [] });
        }}
        onDrop={(event) => {
          const type = event.dataTransfer.getData('application/infracanvas-resource');
          if (type) onDropResource(type, event);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        fitView
        nodesDraggable={!isLocked}
        nodesConnectable={!isLocked}
        elementsSelectable={!isLocked}
        panOnDrag={!isLocked}
        zoomOnDoubleClick={!isLocked}
        zoomOnPinch={!isLocked}
        zoomOnScroll={!isLocked}
        deleteKeyCode={['Backspace', 'Delete']}
        connectionLineStyle={{ stroke: '#f5f5f5', strokeWidth: 3 }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#f5f5f5', strokeWidth: 3 },
          markerEnd: { type: 'arrowclosed', color: '#f5f5f5' },
        }}
      >
        <Background color="#2b2b2b" gap={22} />
        <Panel position="top-left" className="canvas-add-panel">
          <button
            type="button"
            className="canvas-add-button"
            aria-label="Add component"
            title="Add component"
            onClick={() => setIsPaletteOpen((current) => !current)}
          >
            <Plus size={19} />
          </button>
          {isPaletteOpen && (
            <div className="canvas-palette">
              <div className="canvas-palette-header">
                <strong>Add component</strong>
                <span>Select one to place it on the board</span>
              </div>
              <div className="canvas-palette-list">
                {awsResources.map((resource) => {
                  const Icon = resource.Icon;
                  return (
                    <button type="button" key={resource.type} className="canvas-palette-item" onClick={() => addResourceFromPalette(resource.type)}>
                      <span className="resource-icon" style={{ color: resource.color }}>
                        <Icon size={18} />
                      </span>
                      <span>
                        <strong>{resource.label}</strong>
                        <small>{resource.description}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Panel>
        <MiniMap
          className="canvas-minimap"
          position="bottom-right"
          pannable
          zoomable
          nodeBorderRadius={6}
          nodeColor={(node) => {
            const data = node.data as InfraNodeType['data'];
            return resourceByType[data.resourceType].color;
          }}
          nodeStrokeColor="#0a0a0a"
          maskColor="rgb(0 0 0 / 62%)"
          nodeStrokeWidth={2}
        />
        <Panel position="bottom-left" className="canvas-controls" aria-label="Canvas controls">
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomIn({ duration: 180 })}>
            <Plus size={16} />
          </button>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomOut({ duration: 180 })}>
            <Minus size={16} />
          </button>
          <button type="button" aria-label="Fit workflow" title="Fit workflow" onClick={() => fitView({ duration: 260, padding: 0.2 })}>
            <LocateFixed size={16} />
          </button>
          <span className="canvas-controls-divider" />
          <button
            type="button"
            aria-label={isLocked ? 'Unlock canvas' : 'Lock canvas'}
            title={isLocked ? 'Unlock canvas' : 'Lock canvas'}
            className={isLocked ? 'active' : ''}
            onClick={() => setIsLocked((value) => !value)}
          >
            {isLocked ? <Lock size={16} /> : <Unlock size={16} />}
          </button>
          <button
            type="button"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className={isFullscreen ? 'active' : ''}
            onClick={toggleFullscreen}
          >
            <Expand size={16} />
          </button>
        </Panel>
      </ReactFlow>
    </main>
  );
}
