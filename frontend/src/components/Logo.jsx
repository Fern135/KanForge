import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHammer } from '@fortawesome/free-solid-svg-icons';

export const APP_NAME = 'Kanforge';

// Navy tile with a green hammer; matches public/favicon.svg.
export default function Logo({ size = 32 }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden="true">
      <FontAwesomeIcon icon={faHammer} />
    </span>
  );
}
