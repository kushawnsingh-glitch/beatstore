import { FaYoutube, FaInstagram } from 'react-icons/fa';
import KushawnPhoto from '../../src/Images/kushawn-toronto.webp';
import KushawnPhoto2 from '../../src/Images/kushawn-photo2.webp';

const YoutubeSection = () => {
  return (
    <section className="text-white px-6 pb-8">
      <div className="max-w-5xl mx-auto">

        {/* Section heading */}
        <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground mb-12">
          Follow the Journey
        </h2>

        <div className="grid md:grid-cols-2 gap-6">

          {/* YouTube Card */}
          <div className="relative rounded-2xl overflow-hidden group">
            {/* Background photo */}
            <img
              src={KushawnPhoto}
              alt="KUSHAWN"
              className="absolute inset-0 w-full h-full object-cover object-top pointer-events-none transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center text-center gap-4 p-10 py-14">
              <FaYoutube className="text-red-500 text-5xl drop-shadow-lg" />
              <h3 className="text-2xl font-bold text-white">YouTube</h3>
              <p className="text-white/80 max-w-xs">
                Beat drops, studio sessions, and behind-the-scenes content straight from the channel.
              </p>
              <a
                href="https://www.youtube.com/kushawn"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center gap-2 bg-red-600 hover:bg-red-700 !text-white font-semibold py-3 px-7 rounded-full !transition-all !duration-300"
              >
                <FaYoutube className="text-xl" />
                Subscribe
              </a>
            </div>
          </div>

          {/* Instagram Card */}
          <div className="relative rounded-2xl overflow-hidden group">
            {/* Background photo */}
            <img
              src={KushawnPhoto2}
              alt="KUSHAWN"
              className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center text-center gap-4 p-10 py-14">
              <FaInstagram className="text-pink-400 text-5xl drop-shadow-lg" />
              <h3 className="text-2xl font-bold text-white">Instagram</h3>
              <p className="text-white/80 max-w-xs">
                Daily updates, new releases, and a look at life behind the music.
              </p>
              <a
                href="https://www.instagram.com/kushawn"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center gap-2 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 hover:opacity-90 !text-white font-semibold py-3 px-7 rounded-full !transition-all !duration-300"
              >
                <FaInstagram className="text-xl" />
                Follow
              </a>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};

export default YoutubeSection;
