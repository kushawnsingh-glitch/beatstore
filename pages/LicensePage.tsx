import { Helmet } from 'react-helmet';
import KushawnLogo from '../src/Images/kushawn-logo.webp';
import Licenses from '../src/components/Licenses';
const LicensePage = () => {
  const baseUrl = import.meta.env.VITE_APP_BASE_URL || window.location.origin;
  const canonicalUrl = `${baseUrl}/licenses`;
  const title = 'Licenses | KUSHAWN';
  const description =
    'Explore licensing options for type beats and instrumentals at KUSHAWN. Choose the right license for your music production needs.';
  const keywords =
    'music licenses, type beats, instrumentals, music production, KUSHAWN';
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="keywords" content={keywords} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={KushawnLogo} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="KUSHAWN" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={KushawnLogo} />
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            url: canonicalUrl,
            name: title,
            description: description,
            publisher: {
              '@type': 'Organization',
              name: 'KUSHAWN',
              logo: {
                '@type': 'ImageObject',
                url: KushawnLogo,
              },
            },
          })}
        </script>
      </Helmet>
      <Licenses />
    </>
  );
};

export default LicensePage;
