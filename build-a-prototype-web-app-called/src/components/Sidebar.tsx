import { awsResources } from '../data/awsResources';

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div>
        <p className="eyebrow">Resource Palette</p>
        <h2>AWS building blocks</h2>
      </div>
      <div className="resource-list">
        {awsResources.map((resource) => {
          const Icon = resource.Icon;
          return (
            <div
              className="resource-card"
              draggable
              key={resource.type}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/infracanvas-resource', resource.type);
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <span className="resource-icon" style={{ color: resource.color }}>
                <Icon size={20} />
              </span>
              <span>
                <strong>{resource.label}</strong>
                <small>{resource.description}</small>
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
