// Hand-curated discovery examples, researched on 29 October 2026.
// Descriptions and excerpts are editorial summaries, not visitor quotations.
// Unsplash images illustrate the landscape; they are not photographs of each place.
// Original photo IDs are preserved below; sources: https://images.unsplash.com/<id>.
// Local JPEG copies are 1000px wide. Hero source: photo-1512343879784-a960bf40e7f2.
// Destination photos from Wikimedia Commons carry their individual imageCredit.
const stock = (id) => `/images/${id}.jpg`;

const gokarnaOfficial =
  "https://uttarakannada.nic.in/en/tourist-place/gokarna/";
const gokarnaTourism = "https://karnatakatourism.org/en/destinations/gokarna/";
const beachGuide = "https://karnatakatourism.org/en/blogs/gokarna-beaches/";
const trekDiscussion =
  "https://www.reddit.com/r/SoloTravel_India/comments/1iiwdhi/";

export const places = [
  {
    id: "paradise-beach",
    name: "Paradise Beach",
    city: "Gokarna",
    region: "Karnataka",
    category: "Beaches",
    description:
      "A small, rocky cove at the far end of the coastal trail. Arrive on foot and let the day slow down.",
    image: stock("photo-1507525428034-b723cf961d3e"),
    imageAlt:
      "Illustrative stock photograph of a sandy tropical shoreline and turquoise sea",
    tags: ["Secluded cove", "Coastal walk", "Slow travel"],
    sources: [
      {
        title: "Gokarna beaches",
        url: gokarnaOfficial,
        kind: "web",
        publisher: "Uttara Kannada Tourism",
        excerpt:
          "The district guide describes a secluded beach reached by a trek or ferry.",
      },
      {
        title: "Planning a visit to Gokarna",
        url: gokarnaTourism,
        kind: "web",
        publisher: "Karnataka Tourism",
        excerpt:
          "The tourism guide recommends October to March for Gokarna’s beaches and coastal walks.",
      },
      {
        title: "How difficult is the beach trek in Gokarna?",
        url: trekDiscussion,
        kind: "reddit",
        publisher: "r/SoloTravel_India",
        excerpt:
          "Travellers recommend carrying water, wearing shoes with grip, and returning before the trail gets dark.",
      },
    ],
    tip: {
      text: "Carry water and use sturdy footwear for the rocky coastal trail. Plan your return before dark.",
      sourceUrl: trekDiscussion,
      sourceTitle: "Traveller discussion on Reddit",
    },
    bestTime: "October–March",
    featured: true,
  },
  {
    id: "yana-caves",
    name: "Yana Caves",
    city: "Gokarna",
    region: "Uttara Kannada · Karnataka",
    category: "Trails",
    description:
      "Follow a forest path to two towering black limestone formations, with a cave temple tucked beneath the rock.",
    image: "/images/yana-rocks.jpg",
    imageAlt:
      "The dark limestone Yana rock formation rising above the cave temple in Karnataka",
    imageCredit: {
      name: "Photos Worldwide",
      url: "https://commons.wikimedia.org/wiki/File:Yana_Rocks_Karnataka_India.jpg",
      license: "CC0 1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      changes: "Resized thumbnail; displayed cropped to fit.",
    },
    tags: ["Forest trail", "Rock formations", "Day trip"],
    sources: [
      {
        title: "Yana, Kumta",
        url: "https://uttarakannada.nic.in/en/tourist-place/yana-kumta/",
        kind: "web",
        publisher: "Uttara Kannada Tourism",
        excerpt:
          "The district guide describes the twin limestone outcrops and a forest approach from the nearest road.",
      },
      {
        title: "Yana Caves",
        url: "https://karnatakatourism.org/en/attractions/yana-caves/",
        kind: "web",
        publisher: "Karnataka Tourism",
        excerpt:
          "A forest excursion from Gokarna featuring the Bhairaveshwara and Mohini formations and a sacred cave temple.",
      },
    ],
    tip: {
      text: "Wear sturdy shoes and carry water. Check current Forest Department access advice before setting out.",
      sourceUrl: "https://karnatakatourism.org/en/attractions/yana-caves/",
      sourceTitle: "Karnataka Tourism",
    },
    bestTime: "October–March",
    featured: true,
  },
  {
    id: "mirjan-fort",
    name: "Mirjan Fort",
    city: "Gokarna",
    region: "Near Kumta · Karnataka",
    category: "Culture",
    description:
      "Wander broad ramparts and weathered stone passages at this coastal fortress, surrounded by the green landscape near Kumta.",
    image: "/images/mirjan-fort.jpg",
    imageAlt:
      "Stone ramparts and green lawns inside Mirjan Fort beneath a cloudy sky",
    imageCredit: {
      name: "Sourabh bargi",
      url: "https://commons.wikimedia.org/wiki/File:Mirjan_fort.jpg",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      changes: "Resized thumbnail; displayed cropped to fit.",
    },
    tags: ["Heritage", "Architecture", "Day trip"],
    sources: [
      {
        title: "Mirjan Fort",
        url: "https://karnatakatourism.org/en/attractions/mirjan-fort/",
        kind: "web",
        publisher: "Karnataka Tourism",
        excerpt:
          "The tourism guide highlights the fort’s ramparts, maritime history, and location around 22 kilometres from Gokarna.",
      },
      {
        title: "Gokarna itinerary help",
        url: "https://www.reddit.com/r/IndiaTripPlanning/comments/1wt6fnh/gokarna_itinerary_help/",
        kind: "reddit",
        publisher: "r/IndiaTripPlanning",
        excerpt:
          "A traveller suggests combining Mirjan Fort with an inland day visiting Yana and Vibhuti Falls.",
      },
    ],
    tip: {
      text: "Take care on slippery stone paths, and bring water and sun protection.",
      sourceUrl: "https://karnatakatourism.org/en/attractions/mirjan-fort/",
      sourceTitle: "Karnataka Tourism",
    },
    featured: true,
  },
  {
    id: "half-moon-beach",
    name: "Half Moon Beach",
    city: "Gokarna",
    region: "Karnataka",
    category: "Beaches",
    description:
      "A crescent of sand tucked beyond the headland from Om Beach, with a forest approach and an unhurried coastal feel.",
    image: stock("photo-1519046904884-53103b34b206"),
    imageAlt: "Illustrative stock photograph of a palm-lined tropical beach",
    tags: ["Beach trek", "Quiet corners", "Sea views"],
    sources: [
      {
        title: "Gokarna beaches",
        url: gokarnaOfficial,
        kind: "web",
        publisher: "Uttara Kannada Tourism",
        excerpt:
          "The official district page describes a crescent beach reached by a short hill trek.",
      },
      {
        title: "Gokarna’s coastal landscapes",
        url: "https://www.incredibleindia.gov.in/en/karnataka/gokarna/let-the-natural-beauty-of-gokarna-captivate-you",
        kind: "web",
        publisher: "Incredible India",
        excerpt:
          "A cliff separates Half Moon from Om Beach; the name refers to the shoreline’s crescent shape.",
      },
      {
        title: "Planning a visit to Gokarna",
        url: gokarnaTourism,
        kind: "web",
        publisher: "Karnataka Tourism",
        excerpt:
          "October to March is the recommended season for exploring the coast.",
      },
      {
        title: "How difficult is the beach trek in Gokarna?",
        url: trekDiscussion,
        kind: "reddit",
        publisher: "r/SoloTravel_India",
        excerpt:
          "Visitors discuss rocky sections, sun exposure, and the importance of returning in daylight.",
      },
    ],
    tip: {
      text: "Start the coastal walk early and finish in daylight; the route includes rocky and slippery sections.",
      sourceUrl: trekDiscussion,
      sourceTitle: "Traveller discussion on Reddit",
    },
    bestTime: "October–March",
    featured: false,
  },
  {
    id: "belekan-beach",
    name: "Belekan Beach",
    city: "Gokarna",
    region: "Karnataka",
    category: "Beaches",
    description:
      "A quiet, rocky shoreline near Tadadi, and a starting point for the coastal walk toward Paradise and Half Moon.",
    image: stock("photo-1518837695005-2083093ee35b"),
    imageAlt:
      "Illustrative stock photograph of sea waves reaching a rocky coast",
    tags: ["Rocky shoreline", "Trek starting point", "Coastal views"],
    sources: [
      {
        title: "Beyond Gokarna’s main beaches",
        url: gokarnaTourism,
        kind: "web",
        publisher: "Karnataka Tourism",
        excerpt:
          "Belekan is described as a quieter rocky beach south of Paradise and a coastal trek starting point.",
      },
      {
        title: "Trip to Gokarna: itinerary and costing",
        url: "https://www.reddit.com/r/SoloTravel_India/comments/1pqe800/trip_to_gokarna_dec_610_itinerary_costing/",
        kind: "reddit",
        publisher: "r/SoloTravel_India",
        excerpt:
          "A first-hand trip report follows the beach trail to Belekan and describes an auto ride back to Kudle.",
      },
    ],
    tip: {
      text: "Plan transport at both ends of your walk; one traveller finished at Belekan and returned to Kudle by auto.",
      sourceUrl:
        "https://www.reddit.com/r/SoloTravel_India/comments/1pqe800/trip_to_gokarna_dec_610_itinerary_costing/",
      sourceTitle: "First-hand Reddit trip report",
    },
    bestTime: "October–March",
    featured: false,
  },
  {
    id: "nirvana-beach",
    name: "Nirvana Beach",
    city: "Gokarna",
    region: "Kumta coast · Karnataka",
    category: "Beaches",
    description:
      "A long sweep of golden sand away from the main beach circuit, made for slow walks and open horizons.",
    image: stock("photo-1473116763249-2faaef81ccda"),
    imageAlt: "Illustrative stock photograph of a sunlit coastal landscape",
    tags: ["Long walks", "Open coastline", "Sunset"],
    sources: [
      {
        title: "Gokarna’s natural beauty",
        url: "https://www.incredibleindia.gov.in/en/karnataka/gokarna/let-the-natural-beauty-of-gokarna-captivate-you",
        kind: "web",
        publisher: "Incredible India",
        excerpt:
          "The national tourism guide describes Nirvana as a lesser-known stretch of golden sand with sunset views.",
      },
      {
        title: "Gokarna beaches guide",
        url: beachGuide,
        kind: "web",
        publisher: "Karnataka Tourism",
        excerpt:
          "The guide describes a broad beach lined with casuarina trees, away from the main temple town.",
      },
    ],
    bestTime: "November–February",
    featured: false,
  },
  {
    id: "sanapur-lake",
    name: "Sanapur Lake",
    city: "Hampi",
    region: "Koppal · Karnataka",
    category: "Nature",
    description:
      "Trade the temple circuit for a lakeside pause among rocky hills, scrub forest, and the agricultural landscape near Anegundi.",
    image: stock("photo-1476514525535-07fb3b4ae5f1"),
    imageAlt:
      "Illustrative stock photograph of a lake framed by steep green hills",
    tags: ["Lakeside", "Scenic landscape", "Slow travel"],
    sources: [
      {
        title: "Sanapur Dam and Lake",
        url: "https://koppal.nic.in/en/tourist-place/sanapur-dam-and-lake/",
        kind: "web",
        publisher: "Koppal District Tourism",
        excerpt:
          "The district guide places the lake north of Sanapur village, surrounded by hills and scrub forest.",
      },
    ],
    featured: true,
  },
  {
    id: "anegundi",
    name: "Anegundi Village",
    city: "Hampi",
    region: "Koppal · Karnataka",
    category: "Culture",
    description:
      "Explore stone-walled streets, carved wooden doors, and a historic fort in this village beside the Tungabhadra River.",
    image: "/images/anegundi-gagan-mahal.jpg",
    imageAlt:
      "The ornate cream-coloured facade and arched doorway of Gagan Mahal palace in Anegundi",
    imageCredit: {
      name: "iMahesh",
      url: "https://commons.wikimedia.org/wiki/File:Gagan_Mahal_palace,_Anegundi.jpg",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      changes: "Resized thumbnail; displayed cropped to fit.",
    },
    tags: ["Village walk", "History", "Architecture"],
    sources: [
      {
        title: "Anegundi: legends by the riverbank",
        url: "https://www.incredibleindia.gov.in/en/karnataka/hampi/anegundi",
        kind: "web",
        publisher: "Incredible India",
        excerpt:
          "The national tourism guide highlights traditional houses, carved doors, and the temples within Anegundi Fort.",
      },
    ],
    featured: false,
  },
  {
    id: "mandalpatti",
    name: "Mandalpatti Viewpoint",
    city: "Coorg",
    region: "Kodagu · Karnataka",
    category: "Trails",
    description:
      "Rolling grasslands and layers of Western Ghats hills unfold from a viewpoint above the forests near Madikeri.",
    image: stock("photo-1464822759023-fed622ff2c3b"),
    imageAlt:
      "Illustrative stock photograph of a mountain ridge beneath drifting clouds",
    tags: ["Hill views", "Grasslands", "Sunrise"],
    sources: [
      {
        title: "Mandalpatti View Point",
        url: "https://kodagu.nic.in/en/tourist-place/mandalpatti/",
        kind: "web",
        publisher: "Kodagu District Tourism",
        excerpt:
          "The district guide describes views over Pushpagiri grasslands and a 4×4 jeep approach through the hills.",
      },
    ],
    tip: {
      text: "The district tourism guide highlights sunrise and sunset for the views, and recommends a 4×4 jeep approach.",
      sourceUrl: "https://kodagu.nic.in/en/tourist-place/mandalpatti/",
      sourceTitle: "Kodagu District Tourism",
    },
    featured: true,
  },
  {
    id: "nisargadhama",
    name: "Nisargadhama",
    city: "Coorg",
    region: "Near Kushalnagar · Karnataka",
    category: "Nature",
    description:
      "Step into a wooded island on the Cauvery, where bamboo groves and riverside scenery offer a gentle change of pace.",
    image: stock("photo-1441974231531-c6227db76b6e"),
    imageAlt:
      "Illustrative stock photograph of sunlight filtering through a green forest",
    tags: ["Bamboo groves", "River island", "Nature walk"],
    sources: [
      {
        title: "Nisargadhama",
        url: "https://kodagu.nic.in/en/tourist-place/nisargadhama/",
        kind: "web",
        publisher: "Kodagu District Tourism",
        excerpt:
          "An island on the Cauvery with forest and bamboo groves, about 28 kilometres from Madikeri.",
      },
    ],
    featured: false,
  },
  {
    id: "badi-lake",
    name: "Badi Lake & Bahubali Hills",
    city: "Udaipur",
    region: "Rajasthan",
    category: "Nature",
    description:
      "Find a quieter lakeside landscape outside the city, with a hillside trail opening onto wide views of the water.",
    image: stock("photo-1501785888041-af3ef285b470"),
    imageAlt:
      "Illustrative stock photograph of a still lake surrounded by hills",
    tags: ["Lake views", "Hill walk", "Sunset"],
    sources: [
      {
        title: "Badi Lake",
        url: "https://www.incredibleindia.gov.in/en/rajasthan/udaipur/badi-lake",
        kind: "web",
        publisher: "Incredible India",
        excerpt:
          "The national tourism guide describes a lake surrounded by hills and a scenic trek to Bahubali Hill.",
      },
    ],
    tip: {
      text: "The hill path is described as challenging in places; choose the lakeside if a climb is not right for your group.",
      sourceUrl:
        "https://www.incredibleindia.gov.in/en/rajasthan/udaipur/badi-lake",
      sourceTitle: "Incredible India",
    },
    featured: true,
  },
  {
    id: "ahar-cenotaphs",
    name: "Ahar Cenotaphs",
    city: "Udaipur",
    region: "Rajasthan",
    category: "Culture",
    description:
      "Walk among marble memorials, carved pillars, and domed pavilions that preserve the architectural legacy of Mewar’s rulers.",
    image: "/images/ahar-cenotaphs.jpg",
    imageAlt:
      "Domed memorial pavilions and carved stone pillars at Ahar Cenotaphs near Udaipur",
    imageCredit: {
      name: "Jstplace",
      url: "https://commons.wikimedia.org/wiki/File:Ahar_Cenotaphs.JPG",
      license: "Public domain",
      changes: "Resized thumbnail; displayed cropped to fit.",
    },
    tags: ["Architecture", "Heritage walk", "Royal history"],
    sources: [
      {
        title: "Ahar Cenotaphs",
        url: "https://www.incredibleindia.gov.in/en/rajasthan/udaipur/ahar-cenotaphs",
        kind: "web",
        publisher: "Incredible India",
        excerpt:
          "These memorial pavilions honour rulers of Mewar, with carved marble details and an archaeological museum nearby.",
      },
    ],
    featured: false,
  },
];

export default places;
