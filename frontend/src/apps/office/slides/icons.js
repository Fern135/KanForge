import {
  faStar, faHeart, faCheck, faXmark, faCircleCheck, faLightbulb, faRocket, faChartLine, faChartPie, faChartColumn,
  faUsers, faUser, faEnvelope, faPhone, faGlobe, faLocationDot, faCalendar, faClock, faGear, faLock, faShieldHalved,
  faFlag, faTrophy, faBolt, faFire, faLeaf, faCloud, faSun, faMoon, faHouse, faBuilding, faBriefcase, faCartShopping,
  faCreditCard, faDollarSign, faTag, faGift, faBook, faGraduationCap, faLaptop, faMobileScreen, faServer, faDatabase,
  faCode, faBug, faWrench, faMagnifyingGlass, faBell, faComment, faComments, faThumbsUp, faHandshake, faBullseye,
  faPuzzlePiece, faArrowRight, faArrowTrendUp, faCircleInfo, faTriangleExclamation, faCamera, faImage, faMusic,
  faVideo, faPlane, faTruck, faMap, faCompass, faEye,
} from '@fortawesome/free-solid-svg-icons';

// Icons that can go on a slide (Font Awesome Free, CC BY 4.0). The names must
// match the server's allow-list (backend apps/office/slideContent.js).
const LIST = [
  faStar, faHeart, faCheck, faXmark, faCircleCheck, faLightbulb, faRocket, faChartLine, faChartPie, faChartColumn,
  faUsers, faUser, faEnvelope, faPhone, faGlobe, faLocationDot, faCalendar, faClock, faGear, faLock, faShieldHalved,
  faFlag, faTrophy, faBolt, faFire, faLeaf, faCloud, faSun, faMoon, faHouse, faBuilding, faBriefcase, faCartShopping,
  faCreditCard, faDollarSign, faTag, faGift, faBook, faGraduationCap, faLaptop, faMobileScreen, faServer, faDatabase,
  faCode, faBug, faWrench, faMagnifyingGlass, faBell, faComment, faComments, faThumbsUp, faHandshake, faBullseye,
  faPuzzlePiece, faArrowRight, faArrowTrendUp, faCircleInfo, faTriangleExclamation, faCamera, faImage, faMusic,
  faVideo, faPlane, faTruck, faMap, faCompass, faEye,
];

export const ICONS = new Map(LIST.map((def) => [def.iconName, def]));
export const ICON_NAMES = [...ICONS.keys()];

// { width, height, path } for drawing an icon as SVG.
export function iconShape(name) {
  const def = ICONS.get(name) ?? ICONS.get('star');
  const [width, height, , , path] = def.icon;
  return { width, height, path: Array.isArray(path) ? path.join(' ') : path };
}
