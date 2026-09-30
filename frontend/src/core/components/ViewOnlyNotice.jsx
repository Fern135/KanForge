import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye } from '@fortawesome/free-solid-svg-icons';

// Shown in an app this person can view but not change (set by a platform admin).
export default function ViewOnlyNotice({ className = '' }) {
  return (
    <div className={`alert alert-secondary py-1 px-2 small mb-0 d-flex align-items-center gap-2 ${className}`} role="status">
      <FontAwesomeIcon icon={faEye} />
      <span>View only: you can open everything here but not make changes.</span>
    </div>
  );
}
