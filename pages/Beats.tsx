import MailerLitePopUp from '../src/components/MailerLitePopup';
import TrackListing from '@/components/track-listing';
import { Helmet } from 'react-helmet'; // Added for SEO
import BirdieLogo1 from '../src/Images/cropped.png';

const Beats = () => {
  document.title = `KUSHAWN | All Beats`;

  return (
    <>
      <Helmet>
        <title>Beats | KUSHAWN</title>
        <meta
          name="description"
          content="Browse and download high-quality type beats and instrumentals for music production. Find beats inspired by top artists at KUSHAWN."
        />
        <meta
          name="keywords"
          content="type beats, instrumentals, music production, hip hop beats, trap beats, rap beats, KUSHAWN"
        />
        <link rel="canonical" href="https://www.birdiebands.com/beats" />
        <meta property="og:title" content="Beats | KUSHAWN" />
        <meta
          property="og:description"
          content="Browse and download high-quality type beats and instrumentals for music production. Find beats inspired by top artists at KUSHAWN."
        />
        <meta property="og:image" content={BirdieLogo1} />
        <meta property="og:url" content="https://www.birdiebands.com/beats" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="KUSHAWN" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Beats | KUSHAWN" />
        <meta
          name="twitter:description"
          content="Browse and download high-quality type beats and instrumentals for music production. Find beats inspired by top artists at KUSHAWN."
        />
        <meta name="twitter:image" content={BirdieLogo1} />
      </Helmet>
      <TrackListing />
      <MailerLitePopUp />
    </>
  );
};

export default Beats;
