import BeatPackList from '@/components/PacksComponents/BeatPackList';
import BirdieLogo1 from '@/Images/cropped.png';
import { Helmet } from 'react-helmet'; // Added for SEO

const BeatPacks = () => {
  return (
    <>
      <Helmet>
        <title>Beat Packs | KUSHAWN</title>
        <meta
          name="description"
          content="Get premium beat packs. Shop BirdieBands for premium industry-ready beat packs."
        />
        <meta
          name="keywords"
          content="beat packs, mp3 beat packs, exclusive beat packs, 50 beats, 20 beats, KUSHAWN"
        />
        <link rel="canonical" href="https://www.birdiebands.com/packs" />
        <meta property="og:title" content="Beat Packs | KUSHAWN" />
        <meta
          property="og:description"
          content="Get premium beat packs. Shop BirdieBands for premium industry-ready beat packs."
        />
        <meta property="og:image" content={BirdieLogo1} />
        <meta property="og:url" content="https://www.birdiebands.com/packs" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="KUSHAWN" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Beat Packs | KUSHAWN" />
        <meta
          name="twitter:description"
          content="Get premium beat packs. Shop BirdieBands for premium industry-ready beat packs."
        />
        <meta name="twitter:image" content={BirdieLogo1} />
      </Helmet>
      <BeatPackList />
    </>
  );
};

export default BeatPacks;
