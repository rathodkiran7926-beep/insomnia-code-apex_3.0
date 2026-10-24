import { NavLink } from 'react-router-dom';
import { BookOpen, Users, ArrowRight } from 'lucide-react';
import '../styles/engineering-memory.css';
export function CollaborationTabs() {
  return (
    <div className="collaboration-workflow">
      <nav aria-label="Collaboration workflow">
        <NavLink to="/handoffs">
          <Users size={15} /> Handoffs <small>Ask & resolve</small>
        </NavLink>
        <ArrowRight size={14} />
        <NavLink to="/knowledge">
          <BookOpen size={15} /> Team Knowledge <small>Decisions & failure lessons</small>
        </NavLink>
      </nav>
      <p>Discuss once. Keep the reviewed learning connected to its source.</p>
    </div>
  );
}
