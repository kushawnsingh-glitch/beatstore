import { Check, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { NavLink } from 'react-router-dom';

const licenses = [
  {
    name: 'Basic Lease',
    price: '$29.99',
    description:
      'Perfect for independent artists releasing music online. Get a high-quality MP3 to distribute on Spotify, Apple Music, SoundCloud, and more.',
    popular: false,
    included: [
      'MP3 file (320kbps)',
      'Up to 500,000 total streams',
      'Unlimited music video views',
      'Non-profit live performances',
      'Producer credit required in title',
    ],
    excluded: [
      'WAV or stem files',
      'Radio broadcasting',
      'TV / film sync',
    ],
  },
  {
    name: 'Professional Lease',
    price: '$59.99',
    description:
      'The go-to choice for serious artists. Full trackout stems let your mixing engineer shape every element of the sound. Unlimited streaming and radio included.',
    popular: true,
    included: [
      'WAV file (24-bit) + MP3',
      'Full trackout stem files',
      'Unlimited streams + distribution',
      'Radio broadcasting rights',
      'Sync for independent film/video',
      'Producer credit required in title',
    ],
    excluded: [
      'Major studio / commercial TV sync',
    ],
  },
  {
    name: 'Exclusive License',
    price: '$299.99+',
    description:
      'You own it. Once sold exclusively, the beat is removed from the store and no one else can license it. Credit is negotiable. Reach out to discuss terms.',
    popular: false,
    included: [
      'WAV file (24-bit) + MP3',
      'Full trackout stem files',
      'Unlimited streams + distribution',
      'Full radio, TV, and film rights',
      'Beat retired from store permanently',
      'Producer credit negotiable',
    ],
    excluded: [],
  },
];

const Licenses = () => {
  return (
    <div className="flex flex-col gap-12 py-12 px-4">
      <div className="flex flex-col items-center text-center">
        <span className="section-label">Licensing</span>
        <h2 className="text-3xl md:text-4xl font-bold mt-1">License Details</h2>
        <p className="text-foreground/50 text-sm mt-3 max-w-xl">
          All leases include a non-exclusive license. For full ownership, choose the Exclusive License.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto w-full">
        {licenses.map((license, i) => (
          <motion.div
            key={license.name}
            initial={{ y: 40, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
            className={`relative flex flex-col rounded-2xl border p-8 gap-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${
              license.popular
                ? 'border-green-500/60 bg-green-500/5 shadow-[0_0_32px_rgba(64,145,108,0.15)]'
                : 'border-foreground/10 bg-foreground/[0.02] hover:border-foreground/20'
            }`}
          >
            {/* Popular badge */}
            {license.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-green-500 text-white text-xs font-semibold px-4 py-1 rounded-full tracking-wide">
                  Most Popular
                </span>
              </div>
            )}

            {/* Header */}
            <div className="flex flex-col gap-2">
              <h3
                className="text-xl font-bold"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                {license.name}
              </h3>
              <p
                className={`text-4xl font-bold ${license.popular ? 'text-green-400' : 'text-foreground'}`}
              >
                {license.price}
              </p>
              <p className="text-foreground/60 text-sm leading-relaxed">
                {license.description}
              </p>
            </div>

            {/* Divider */}
            <hr className="border-foreground/10" />

            {/* Features */}
            <ul className="flex flex-col gap-3 flex-1">
              {license.included.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm text-foreground/80">
                  <Check className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                  {feature}
                </li>
              ))}
              {license.excluded.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm text-foreground/40 line-through">
                  <X className="w-4 h-4 text-foreground/20 mt-0.5 shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            {/* CTA */}
            <NavLink
              to={license.name === 'Exclusive License' ? '/contact' : '/beats'}
              className={`text-center py-3 px-6 rounded-full text-sm font-semibold !transition-all !duration-300 ${
                license.popular
                  ? '!bg-green-500 !text-white hover:!bg-green-400'
                  : license.name === 'Exclusive License'
                  ? '!bg-foreground !text-background hover:!bg-foreground/80'
                  : '!border !border-foreground/20 !bg-transparent !text-foreground hover:!border-green-500/50 hover:!text-green-400'
              }`}
            >
              {license.name === 'Exclusive License' ? 'Get In Touch' : 'Browse Beats'}
            </NavLink>
          </motion.div>
        ))}
      </div>

      {/* Full license details link */}
      <p className="text-center text-sm text-foreground/40">
        Read the full{' '}
        <NavLink to="/licenses" className="!text-green-400 hover:underline">
          License Agreement
        </NavLink>
      </p>
    </div>
  );
};

export default Licenses;
