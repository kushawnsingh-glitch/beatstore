import { Helmet } from 'react-helmet'; // Added for SEO
import KushawnLogo from '@/Images/kushawn-logo.webp';
import PackList from '@/components/PackList';

const Packs = () => {
  document.title = `KUSHAWN | Sample Loop Packs`;

  return (
    <>
      <Helmet>
        <title>Sample Loop Packs | KUSHAWN</title>
        <meta
          name="description"
          content="Discover premium sample loop packs for hip hop, soul, trap, and West Coast production. Shop KUSHAWN for exclusive loops, royalty-free samples, and industry-ready sounds used by top artists."
        />
        <meta
          name="keywords"
          content="sample packs, loop packs, sample loop packs, g-funk loop packs, soul samples, KUSHAWN"
        />
        <link rel="canonical" href="https://kushawn.com/packs" />
        <meta property="og:title" content="Sample Loop Packs | KUSHAWN" />
        <meta
          property="og:description"
          content="Discover premium sample loop packs for hip hop, soul, trap, and West Coast production. Shop KUSHAWN for exclusive loops, royalty-free samples, and industry-ready sounds used by top artists."
        />
        <meta property="og:image" content={KushawnLogo} />
        <meta property="og:url" content="https://kushawn.com/packs" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="KUSHAWN" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Sample Loop Packs | KUSHAWN" />
        <meta
          name="twitter:description"
          content="Discover premium sample loop packs for hip hop, soul, trap, and West Coast production. Shop KUSHAWN for exclusive loops, royalty-free samples, and industry-ready sounds used by top artists."
        />
        <meta name="twitter:image" content={KushawnLogo} />
      </Helmet>
      <PackList />
    </>
  );
};

export default Packs;
