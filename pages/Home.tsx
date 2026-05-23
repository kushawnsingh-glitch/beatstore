import Artists from '@/components/Artists';
import FAQS from '@/components/FAQS';
import Licenses from '@/components/Licenses';
import TrackListing from '@/components/track-listing';
import { MoveUp } from 'lucide-react';
import { FaYoutube, FaInstagram } from 'react-icons/fa';
import BirdieLogo from '../src/Images/cropped.png';
import KushawnPhoto from '../src/Images/kushawn-toronto.png';
import { Helmet } from 'react-helmet';
import { useEffect, useState } from 'react';
import YoutubeSection from '@/components/YouTube';
import MailerLitePopUp from '../src/components/MailerLitePopup';

const Home = ({ size }: { size: string }) => {
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const ninetyPercentHeight = 0.9 * documentHeight;
      setShowButton(scrollPosition + windowHeight >= ninetyPercentHeight);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const baseUrl = window.location.origin;
  const canonicalUrl = `${baseUrl}/`;
  const title = 'KUSHAWN | Premium Instrumentals & Beats';
  const description =
    'Discover premium instrumentals and beats from KUSHAWN — acoustic guitar, tabla, piano and more. Music as a vehicle for healing and transcendence.';
  const keywords =
    'instrumentals, acoustic guitar instrumental, tabla instrumental, piano instrumental, music production, KUSHAWN, healing music, transcendence';
  const imageUrl = BirdieLogo;

  return (
    <div className="overflow-x-hidden flex flex-col gap-64 relative">
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="keywords" content={keywords} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={imageUrl} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="KUSHAWN" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={imageUrl} />
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            url: canonicalUrl,
            name: 'KUSHAWN',
            description,
            publisher: { '@type': 'Organization', name: 'KUSHAWN', logo: { '@type': 'ImageObject', url: imageUrl } },
            potentialAction: { '@type': 'SearchAction', target: `${baseUrl}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
          })}
        </script>
      </Helmet>

      <MailerLitePopUp />

      {/* Beat store */}
      <TrackListing limitTrackCount={50} />

      {/* Instrumentals section */}
      <Artists size={size} />

      {/* Licenses */}
      <Licenses />

      {/* About the Artist */}
      <section className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row gap-16 items-center">
        <div className="relative rounded-2xl overflow-hidden shrink-0 w-full md:w-80 aspect-[3/4] shadow-2xl">
          <img
            src={KushawnPhoto}
            alt="KUSHAWN"
            className="w-full h-full object-cover object-top pointer-events-none"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        </div>
        <div className="flex flex-col gap-6">
          <span className="section-label">About</span>
          <h2 className="text-3xl md:text-4xl font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>
            The Artist
          </h2>
          <p className="text-foreground/70 text-lg leading-relaxed">
            Kushawn is a multi-instrument musician whose music transcends genre and invites listeners into a world built from rhythm, melody, and raw expression. With a deep command of guitar, tabla, piano, and more — every recording is a unique sonic journey.
          </p>
          <p className="text-foreground/70 text-lg leading-relaxed italic" style={{ fontFamily: "'Playfair Display', serif" }}>
            "Music as a vehicle for healing and transcendence"
          </p>
          <div className="flex gap-3 flex-wrap mt-2">
            <a
              href="https://www.youtube.com/kushawn"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium border border-white/10 bg-red-500/10 hover:bg-red-500/20 hover:border-red-500/30 !text-foreground !transition-all !duration-300"
            >
              <FaYoutube className="text-red-500" />
              youtube.com/kushawn
            </a>
            <a
              href="https://www.instagram.com/kushawn"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium border border-white/10 bg-purple-500/10 hover:bg-purple-500/20 hover:border-purple-500/30 !text-foreground !transition-all !duration-300"
            >
              <FaInstagram className="text-pink-400" />
              instagram.com/kushawn
            </a>
          </div>
        </div>
      </section>

      {/* Follow the Journey */}
      <YoutubeSection />

      {/* FAQs */}
      <div className="flex flex-col justify-center self-center md:min-w-6xl px-6">
        <div className="z-50 flex flex-col gap-12">
          <h2 className={`font-bold ${size}`}>FAQS</h2>
          <FAQS />
        </div>
      </div>

      {showButton && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="z-50 fixed bottom-35 lg:right-20 right-5 transition-all duration-300 transform !bg-transparent"
        >
          <MoveUp />
        </button>
      )}
    </div>
  );
};

export default Home;
