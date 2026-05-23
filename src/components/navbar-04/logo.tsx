import { NavLink } from 'react-router-dom';
import KushawnLogo from '../../Images/kushawn-logo.png';

export const Logo = () => {
  return (
    <NavLink to="/" className="flex items-center">
      <img
        className="w-48 pointer-events-none"
        src={KushawnLogo}
        alt="KUSHAWN Logo"
      />
    </NavLink>
  );
};
