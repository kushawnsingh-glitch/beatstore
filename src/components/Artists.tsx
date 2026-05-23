// src/components/Artists.tsx
import { motion } from 'framer-motion';
import TiltedCard from './ui/ReactBits/TitledCard';
import { useNavigate } from 'react-router-dom';
import TablaImage from '../Images/tabla.jpg';

const instrumentals = [
  {
    label: 'Acoustic Guitar',
    search: 'Acoustic Guitar',
    imageSrc: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400&h=400&fit=crop&q=80',
    alt: 'Acoustic Guitar Instrumentals',
  },
  {
    label: 'Tabla',
    search: 'Tabla',
    imageSrc: TablaImage,
    alt: 'Tabla Instrumentals',
  },
  {
    label: 'Piano',
    search: 'Piano',
    imageSrc: 'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=400&h=400&fit=crop&q=80',
    alt: 'Piano Instrumentals',
  },
];

const Artists = ({ size }: { size: string }) => {
  const navigate = useNavigate();

  const handleCardClick = (term: string) => {
    navigate(`/beats?search=${encodeURIComponent(term)}`);
  };

  return (
    <>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: [0, 0.71, 0.2, 1.01] }}
        className="flex flex-col gap-12"
      >
        <div>
          <h2 className={`font-bold ${size}`}>Instrumentals</h2>
          <p className="text-sm text-gray-500 mt-1">
            Tap an image to explore instrumentals by style.
          </p>
        </div>
        <div className="flex gap-24 flex-wrap justify-center z-10">
          {instrumentals.map(({ label, search, imageSrc, alt }) => (
            <div key={label} onClick={() => handleCardClick(search)}>
              <TiltedCard
                imageSrc={imageSrc}
                altText={alt}
                captionText={`${label} Instrumentals`}
                containerHeight="300px"
                containerWidth="300px"
                imageHeight="300px"
                imageWidth="300px"
                rotateAmplitude={12}
                scaleOnHover={1.2}
                showMobileWarning={false}
                showTooltip={true}
                displayOverlayContent={true}
                overlayContent={
                  <p className="bg-background/50 m-6 p-3 rounded-2xl font-bold">
                    {label} Instrumentals
                  </p>
                }
              />
            </div>
          ))}
        </div>
      </motion.div>
    </>
  );
};

export default Artists;
