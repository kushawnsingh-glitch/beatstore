import KushawnLogo from '/src/Images/kushawn-logo.png';
import { FaCcVisa, FaCcMastercard, FaCcPaypal, FaCcStripe, FaYoutube, FaInstagram } from 'react-icons/fa';
import { NavLink } from 'react-router';

const Footer = () => {
  const currentYear = new Date().getFullYear();
  return (
    <div className="mb-32 z-40 py-10 relative">
      <footer className=" rounded-lg m-4 relative">
        <div className="max-w-6xl  mx-auto p-4 md:py-8">
          <div className="sm:flex sm:items-center sm:justify-between">
            <NavLink
              to={'/'}
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="flex items-center mb-4 sm:mb-0 space-x-3 rtl:space-x-reverse"
            >
              <img
                src={KushawnLogo}
                className="h-8 translate-y-1"
                alt="KUSHAWN Logo"
              />
            </NavLink>
            <ul className="flex flex-wrap items-center mb-6 text-sm font-medium  max-sm:justify-center sm:mb-0">
              <li>
                <NavLink
                  to={'/refund-policy'}
                  className="!text-foreground hover:!underline !transition-all !duration-300 me-4 md:me-6"
                >
                  Refund Policy
                </NavLink>
              </li>
              <li>
                <NavLink
                  to={'/privacy-policy'}
                  className="!text-foreground hover:!underline !transition-all !duration-300 me-4 md:me-6"
                >
                  Privacy Policy
                </NavLink>
              </li>
              <li>
                <NavLink
                  to={'/terms-of-service'}
                  className="!text-foreground hover:!underline !transition-all !duration-300 me-4 md:me-6"
                >
                  Terms of Use
                </NavLink>
              </li>
              <li>
                <NavLink
                  to={'/licenses'}
                  className="!text-foreground hover:!underline !transition-all !duration-300 me-4 md:me-6"
                >
                  Licensing
                </NavLink>
              </li>
              <li>
                <NavLink
                  to={'/faqs'}
                  className="!text-foreground hover:!underline !transition-all !duration-300 me-4 md:me-6"
                >
                  FAQS
                </NavLink>
              </li>
              <li>
                <NavLink
                  to={'/newsletter'}
                  className="!text-foreground hover:!underline !transition-all !duration-300 me-4 md:me-6"
                >
                  Newsletter
                </NavLink>
              </li>
              {/* <li>
                <NavLink
                  to={'/contact'}
                  className="!text-foreground hover:!underline !transition-all !duration-300"
                >
                  Contact
                </NavLink>
              </li> */}
            </ul>
          </div>
          <div className="min-[300px]:flex min-[300px]:justify-center min-[300px]:items-center sm:flex sm:items-center sm:justify-end">
            <ul className="flex flex-wrap items-center mb-6 min-sm:my-3 text-sm font-medium space-x-6 sm:mb-0">
              <li>
                <FaCcVisa size={30} />
              </li>
              <li>
                <FaCcMastercard size={30} />
              </li>
              <li>
                <FaCcPaypal size={30} />
              </li>
              <li>
                <FaCcStripe size={30} />
              </li>
              {/* <li>
                <SiCoinbase size={50} />
              </li> */}
            </ul>
          </div>
          {/* Social links */}
          <div className="flex justify-center gap-6 my-6">
            <a
              href="https://www.youtube.com/kushawn"
              target="_blank"
              rel="noopener noreferrer"
              className="!text-foreground/50 hover:!text-red-500 !transition-colors !duration-300"
              aria-label="YouTube"
            >
              <FaYoutube size={22} />
            </a>
            <a
              href="https://www.instagram.com/kushawn"
              target="_blank"
              rel="noopener noreferrer"
              className="!text-foreground/50 hover:!text-pink-400 !transition-colors !duration-300"
              aria-label="Instagram"
            >
              <FaInstagram size={22} />
            </a>
          </div>

          <hr className="my-6 border-foreground sm:mx-auto dark:border-foreground/30 lg:my-8" />
          <span className="block text-sm text-gray-500 sm:text-center dark:text-gray-400">
            © {currentYear}{' '}
            <button
              // on click scroll to top
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="!text-foreground hover:underline !p-0 !m-0 !bg-transparent hover:!bg-transparent !transition-all !duration-300"
            >
              KUSHAWN™
            </button>
            . All Rights Reserved.
          </span>
        </div>
        {/* <button className="sticky bottom-20 translate-x-96 ">
          <MoveUp />
        </button> */}
      </footer>
    </div>
  );
};

export default Footer;
