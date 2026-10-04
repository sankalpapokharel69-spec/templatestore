-- ============================================================
-- WebCraft Studio — sample data (safe to re-run)
-- Apply: npx wrangler d1 execute webcraft-db --remote --file=seed.sql
-- ============================================================

INSERT OR IGNORE INTO categories (name, slug) VALUES
  ('Restaurant','restaurant'),
  ('Hotel','hotel'),
  ('Salon','salon'),
  ('Furniture','furniture'),
  ('Real Estate','real-estate'),
  ('Gym','gym'),
  ('Photography','photography'),
  ('Portfolio','portfolio'),
  ('Business','business');

INSERT OR IGNORE INTO templates (title, slug, category_id, price, description, features, pages_count, demo_url, zip_key, featured) VALUES
('Bistro Bright','bistro-bright',(SELECT id FROM categories WHERE slug='restaurant'),39,
 'A warm, appetizing design built for cafés, bistros and full-service restaurants. Present your menu, chef story and reservations with a layout that makes food look irresistible.',
 'Responsive menu & specials sections
Table reservation form section
Chef story and gallery pages
Google Maps location block
Instagram feed gallery
Sticky navbar with smooth scrolling',6,'','gen/bistro-bright.zip',1),
('Golden Fork','golden-fork',(SELECT id FROM categories WHERE slug='restaurant'),49,
 'An elegant multi-page template for fine-dining restaurants. Includes tasting menus, a wine list, private events and press pages with a refined gold-accent palette.',
 'Tasting menu and wine list layouts
Private events inquiry form
Press and awards section
Reservation CTA section
Full menu download button
Elegant serif typography',8,'','gen/golden-fork.zip',0),
('Serene Suites','serene-suites',(SELECT id FROM categories WHERE slug='hotel'),59,
 'A calm, luxurious template for boutique hotels and resorts. Room galleries, amenity highlights and a booking flow that turns visitors into guests.',
 'Room & suite gallery with rates
Booking inquiry form
Amenities and spa pages
Guest testimonials slider
Nearby attractions guide
Multi-language ready markup',9,'','gen/serene-suites.zip',1),
('Grand Horizon','grand-horizon',(SELECT id FROM categories WHERE slug='hotel'),69,
 'A grand template for full-service hotels with conference facilities, dining, spa and events — everything a large property needs to look world-class.',
 'Conference & events pages
Spa and dining sections
Virtual-tour-ready galleries
Special offers carousel
FAQ and policies pages
Accessibility-focused markup',10,'','gen/grand-horizon.zip',0),
('Velvet Glow','velvet-glow',(SELECT id FROM categories WHERE slug='salon'),35,
 'A soft, modern template for hair salons, spas and beauty studios. Showcase services, stylists and before/after transformations with a gentle pastel aesthetic.',
 'Service menu with pricing
Stylist profile cards
Before/after gallery
Online booking CTA section
Gift card highlight block
WhatsApp booking button',5,'','gen/velvet-glow.zip',1),
('Oak & Ember','oak-ember',(SELECT id FROM categories WHERE slug='furniture'),45,
 'A warm, editorial template for furniture stores and interior studios. Lookbook galleries, product pages and craft-story sections with a natural, tactile feel.',
 'Lookbook and collection galleries
Product detail pages
Craft & materials story section
Room inspiration boards
Store locator section
Newsletter signup form',7,'','gen/oak-ember.zip',0),
('Prime Estates','prime-estates',(SELECT id FROM categories WHERE slug='real-estate'),65,
 'A professional template for real estate agencies. Property listings with filters, agent profiles, neighborhood guides and inquiry forms that convert.',
 'Property listing grid with filters
Property detail pages
Agent profile cards
Neighborhood guide pages
Mortgage calculator section
Schedule-a-viewing form',8,'','gen/prime-estates.zip',1),
('IronPulse','ironpulse',(SELECT id FROM categories WHERE slug='gym'),42,
 'A bold, high-energy template for gyms, CrossFit boxes and fitness studios. Class schedules, trainer bios and membership pricing that motivate sign-ups.',
 'Class schedule table
Trainer profile cards
Membership pricing table
Transformation gallery
Free-trial signup form
Countdown timer for challenges',6,'','gen/ironpulse.zip',0),
('Lumina','lumina',(SELECT id FROM categories WHERE slug='photography'),38,
 'A minimal, gallery-first template for photographers. Full-bleed sliders, elegant proofing pages and typography that stays out of the way of your images.',
 'Full-bleed hero slider
Portfolio galleries with lightbox
Client proofing page
About the photographer section
Pricing and booking form
Lazy-loaded image galleries',5,'','gen/lumina.zip',1),
('Mono Portfolio','mono-portfolio',(SELECT id FROM categories WHERE slug='portfolio'),25,
 'A striking single-column portfolio for designers, developers and creatives who let the work speak. Dark-mode ready with buttery-smooth scroll animations.',
 'Case study layout
Skills and services section
Contact form with validation
Dark mode toggle included
Scroll reveal animations
Lighthouse-friendly markup',4,'','gen/mono-portfolio.zip',0),
('Corporate Pro','corporate-pro',(SELECT id FROM categories WHERE slug='business'),55,
 'A polished template for consultancies, agencies and B2B firms. Services, case studies, team and careers pages with a trustworthy professional look.',
 'Services overview pages
Case study layout
Team and leadership pages
Careers and job listing section
Client logo wall
Insights/blog starter pages',9,'','gen/corporate-pro.zip',1),
('Startup Launch','startup-launch',(SELECT id FROM categories WHERE slug='business'),29,
 'A conversion-focused template for SaaS products and startups. Hero with product shots, feature grid, pricing and waitlist sections ready to ship.',
 'Pricing table with toggle
Feature grid with icons
Testimonial wall
FAQ accordion section
Waitlist email capture
Product screenshot showcase',5,'','gen/startup-launch.zip',0);

INSERT OR IGNORE INTO template_screenshots (template_id, r2_key, sort)
SELECT id, 'gen/' || slug || '-1.svg', 0 FROM templates;
INSERT OR IGNORE INTO template_screenshots (template_id, r2_key, sort)
SELECT id, 'gen/' || slug || '-2.svg', 1 FROM templates;
INSERT OR IGNORE INTO template_screenshots (template_id, r2_key, sort)
SELECT id, 'gen/' || slug || '-3.svg', 2 FROM templates;

INSERT INTO messages (type, name, email, subject, message)
SELECT 'contact','Aarav Shrestha','aarav@example.com','Custom restaurant template?',
 'Hi! Do you offer customization for the Bistro Bright template? I need a food delivery section added before I launch.'
WHERE NOT EXISTS (SELECT 1 FROM messages);

INSERT INTO messages (type, name, email, subject, message)
SELECT 'support','Priya Karki','priya@example.com','Download issue',
 'I purchased Prime Estates but the download button is not working on my phone. Can you help me get the files?'
WHERE NOT EXISTS (SELECT 1 FROM messages WHERE type='support');