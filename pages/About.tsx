import { motion } from 'framer-motion';
import KushawnPhoto from '../src/Images/kushawn-toronto.webp';
import KushawnLogo from '../src/Images/kushawn-logo.webp';
import { NavLink } from 'react-router-dom';

const About = () => {
  document.title = `KUSHAWN | About`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="min-h-screen"
    >
      {/* Hero */}
      <div className="relative w-full h-[70vh] overflow-hidden flex items-end">
        <img
          src={KushawnPhoto}
          alt="KUSHAWN in Toronto"
          className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none"
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
          className="relative z-10 px-8 pb-12 max-w-4xl mx-auto w-full"
        >
          <img
            src={KushawnLogo}
            alt="KUSHAWN"
            className="w-48 md:w-64 mb-4 pointer-events-none drop-shadow-[0_2px_16px_rgba(0,0,0,0.9)]"
          />
          <p className="text-white/80 text-lg md:text-xl font-light tracking-wide">
            Musician · Producer · Toronto
          </p>
        </motion.div>
      </div>

      {/* Bio Section */}
      <div className="max-w-4xl mx-auto px-8 py-20 flex flex-col gap-16">

        <motion.div
          initial={{ y: 40, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="grid md:grid-cols-2 gap-12 items-center"
        >
          <div className="flex flex-col gap-6">
            <h2 className="text-3xl md:text-4xl font-bold">The Artist</h2>
            <p className="text-foreground/70 text-lg leading-relaxed">
              KUSHAWN is a Toronto-based musician and producer crafting
              instrumentals that blend acoustic guitar, tabla, and piano into
              something entirely his own. Rooted in diverse musical traditions,
              his sound bridges cultures and genres.
            </p>
            <p className="text-foreground/70 text-lg leading-relaxed">
              Every instrumental is built with intention — designed to give
              artists the perfect foundation to tell their story.
            </p>
          </div>
          <div className="relative rounded-2xl overflow-hidden aspect-[3/4] shadow-2xl">
            <img
              src={KushawnPhoto}
              alt="KUSHAWN"
              className="w-full h-full object-cover object-top pointer-events-none"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          </div>
        </motion.div>

        {/* Stats / Highlights */}
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="grid grid-cols-3 gap-6 text-center border-t border-foreground/10 pt-16"
        >
          {[
            { label: 'Based In', value: 'Toronto' },
            { label: 'Style', value: 'Acoustic · Tabla · Piano' },
            { label: 'Available For', value: 'Licensing' },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col gap-2">
              <span className="text-foreground/40 text-sm uppercase tracking-widest">{label}</span>
              <span className="text-foreground font-semibold text-lg">{value}</span>
            </div>
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="flex flex-col sm:flex-row gap-4 items-center justify-center pt-4"
        >
          <NavLink
            to="/beats"
            className="!bg-foreground !text-background px-8 py-3 rounded font-semibold hover:!bg-green-400 hover:!text-black !transition-colors !duration-300"
          >
            Browse Instrumentals
          </NavLink>
          <NavLink
            to="/contact"
            className="!bg-transparent border border-foreground/30 !text-foreground px-8 py-3 rounded font-semibold hover:!border-green-400 hover:!text-green-400 !transition-colors !duration-300"
          >
            Get In Touch
          </NavLink>
        </motion.div>

      </div>
    </motion.div>
  );
};

export default About;
