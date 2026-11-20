import Hero from '@/platform/home/Hero.jsx';
import TopPlayers from '@/platform/home/TopPlayers.jsx';
import FriendsStrip from '@/components/shell/home/FriendsStrip.jsx';
import DailyReward from '@/components/shell/home/DailyReward.jsx';
import IndiaArt from '@/components/art/IndiaArt.jsx';
import '@/styles/hubhome.css';
import '@/platform/home/street-home.css';

const CITY_PRINTS = [['mumbai', 'MUMBAI', 'Gateway of India'], ['jaipur', 'JAIPUR', 'Hawa Mahal'], ['chennai', 'CHENNAI', 'Chennai Central'], ['kolkata', 'KOLKATA', 'Howrah Bridge']];

export default function Home() {
  return (
    <div className="hub-page hh2 hh2-home street-home film-home">
      <Hero />
      <section className="street-prints film-section" aria-labelledby="street-prints-title">
        <div className="street-prints__intro"><p className="street-home__eyebrow">Postcards from the gully</p><h2 id="street-prints-title">LOCAL COLOUR.<br /><span>ALL OVER.</span></h2><p>Landmarks in ink. A little piece of home.</p></div>
        <div className="street-prints__collection">{CITY_PRINTS.map(([art, city, landmark]) => <figure className={`street-print street-print--${art}`} key={art}><IndiaArt art={art} className="street-print__art" decorative /><figcaption><b>{city}</b><span>{landmark}</span></figcaption></figure>)}</div>
      </section>
      <FriendsStrip />
      <section className="street-legends film-section" aria-labelledby="street-legends-title"><header className="street-legends__head"><p className="street-home__eyebrow">Good games deserve good company</p><h2 id="street-legends-title">GULLY <span>LEGENDS.</span></h2></header><div className="hh2-duo street-legends__content"><TopPlayers /><DailyReward /></div></section>
    </div>
  );
}
