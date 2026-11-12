import { Router } from 'express';
import {
  ID_BOUNDS,
  JABODETABEK_BOUNDS,
  isWithinIndonesiaBounds,
  deconstructIndonesianAddress,
  composeDetailedIndonesianLocation,
} from '../services/addressParser.js';

const router = Router();

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 500;
const FETCH_TIMEOUT_MS = 2800;
const geocodeCache = new Map();

/**
 * Katalog terkurasi lokasi populer, pusat perbelanjaan, stasiun, rumah sakit,
 * universitas, dan koridor jalan utama di DKI Jakarta & Jabodetabek.
 * Menjamin respons 0ms dan ketahanan 100% bahkan saat jaringan eksternal terganggu.
 */
const JAKARTA_GAZETTEER = [
  // Pusat Perbelanjaan & Landmark Utama
  { id: 'poi-grand-indonesia', nama: 'Grand Indonesia', road: 'Jl. M.H. Thamrin', kelurahan: 'Kebon Melati', kecamatan: 'Menteng', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Jl. M.H. Thamrin, Menteng, Jakarta Pusat', lat: -6.1950, lon: 106.8198, keywords: 'gi mall thamrin bundaran hi' },
  { id: 'poi-plaza-indonesia', nama: 'Plaza Indonesia', road: 'Jl. M.H. Thamrin', kelurahan: 'Gondangdia', kecamatan: 'Menteng', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Jl. M.H. Thamrin, Menteng, Jakarta Pusat', lat: -6.1931, lon: 106.8219, keywords: 'pi mall thamrin bundaran hi' },
  { id: 'poi-thamrin-city', nama: 'Thamrin City', road: 'Jl. K.H. Mas Mansyur', kelurahan: 'Kebon Melati', kecamatan: 'Tanah Abang', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Jl. KH Mas Mansyur, Tanah Abang, Jakarta Pusat', lat: -6.1942, lon: 106.8157, keywords: 'tanah abang kebon melati' },
  { id: 'poi-sarinah', nama: 'Sarinah Thamrin', road: 'Jl. M.H. Thamrin', kelurahan: 'Gondangdia', kecamatan: 'Menteng', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Jl. M.H. Thamrin, Gondangdia, Jakarta Pusat', lat: -6.1873, lon: 106.8235, keywords: 'sarinah menteng' },
  { id: 'poi-monas', nama: 'Monumen Nasional (Monas)', road: 'Jl. Medan Merdeka', kelurahan: 'Gambir', kecamatan: 'Gambir', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Gambir, Jakarta Pusat', lat: -6.1754, lon: 106.8272, keywords: 'monas medan merdeka gambir' },
  { id: 'poi-bundaran-hi', nama: 'Bundaran HI', road: 'Jl. M.H. Thamrin', kelurahan: 'Menteng', kecamatan: 'Menteng', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Menteng, Jakarta Pusat', lat: -6.1944, lon: 106.8230, keywords: 'hotel indonesia thamrin sudirman' },
  { id: 'poi-tanah-abang', nama: 'Pasar Tanah Abang', road: 'Jl. K.H. Fachrudin', kelurahan: 'Kampung Bali', kecamatan: 'Tanah Abang', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Kampung Bali, Tanah Abang, Jakarta Pusat', lat: -6.1887, lon: 106.8117, keywords: 'blok a blok b tanah abang' },
  { id: 'poi-senayan-city', nama: 'Senayan City', road: 'Jl. Asia Afrika', kelurahan: 'Gelora', kecamatan: 'Tanah Abang', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Jl. Asia Afrika, Gelora, Jakarta Pusat', lat: -6.2272, lon: 106.7973, keywords: 'senci senayan' },
  { id: 'poi-plaza-senayan', nama: 'Plaza Senayan', road: 'Jl. Asia Afrika', kelurahan: 'Gelora', kecamatan: 'Tanah Abang', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Jl. Asia Afrika, Gelora, Jakarta Pusat', lat: -6.2254, lon: 106.7993, keywords: 'ps senayan' },
  { id: 'poi-gbk', nama: 'Gelora Bung Karno (GBK)', road: 'Jl. Pintu Satu Senayan', kelurahan: 'Gelora', kecamatan: 'Tanah Abang', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Senayan, Jakarta Pusat', lat: -6.2186, lon: 106.8018, keywords: 'stadion gbk senayan' },
  { id: 'poi-pacific-place', nama: 'Pacific Place & SCBD', road: 'Jl. Jend. Sudirman', kelurahan: 'Senayan', kecamatan: 'Kebayoran Baru', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'SCBD, Jl. Jend. Sudirman, Jakarta Selatan', lat: -6.2243, lon: 106.8097, keywords: 'scbd sudirman central business district' },
  { id: 'poi-fx-sudirman', nama: 'fX Sudirman', road: 'Jl. Jend. Sudirman', kelurahan: 'Gelora', kecamatan: 'Tanah Abang', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Jl. Jend. Sudirman, Senayan, Jakarta Pusat', lat: -6.2246, lon: 106.8039, keywords: 'fx lifestyle sudirman' },
  { id: 'poi-kota-kasablanka', nama: 'Kota Kasablanka (Kokas)', road: 'Jl. Casablanca Raya', kelurahan: 'Menteng Dalam', kecamatan: 'Tebet', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Jl. Casablanca Raya, Tebet, Jakarta Selatan', lat: -6.2241, lon: 106.8422, keywords: 'kokas tebet kuningan casablanca' },
  { id: 'poi-lotter-avenue', nama: 'Lotte Shopping Avenue', road: 'Jl. Prof. DR. Satrio', kelurahan: 'Karet Kuningan', kecamatan: 'Setiabudi', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Ciputra World, Kuningan, Jakarta Selatan', lat: -6.2238, lon: 106.8229, keywords: 'kuningan satrio' },
  { id: 'poi-kuningan-city', nama: 'Kuningan City', road: 'Jl. Prof. DR. Satrio', kelurahan: 'Karet Kuningan', kecamatan: 'Setiabudi', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Jl. Prof. DR. Satrio, Kuningan, Jakarta Selatan', lat: -6.2248, lon: 106.8296, keywords: 'kuncit satrio kuningan' },
  { id: 'poi-ambassador', nama: 'Mal Ambassador & ITC Kuningan', road: 'Jl. Prof. DR. Satrio', kelurahan: 'Karet Kuningan', kecamatan: 'Setiabudi', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Jl. Prof. DR. Satrio, Kuningan, Jakarta Selatan', lat: -6.2239, lon: 106.8266, keywords: 'ambas itc kuningan' },
  { id: 'poi-blok-m-plaza', nama: 'Blok M Plaza & M Bloc Space', road: 'Jl. Bulungan', kelurahan: 'Kramat Pela', kecamatan: 'Kebayoran Baru', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Kramat Pela, Kebayoran Baru, Jakarta Selatan', lat: -6.2441, lon: 106.7995, keywords: 'blok m square m bloc melawai' },
  { id: 'poi-gandaria-city', nama: 'Gandaria City (Gancit)', road: 'Jl. Sultan Iskandar Muda', kelurahan: 'Kebayoran Lama Utara', kecamatan: 'Kebayoran Lama', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Kebayoran Lama, Jakarta Selatan', lat: -6.2442, lon: 106.7835, keywords: 'gancit sultan iskandar muda' },
  { id: 'poi-pim', nama: 'Pondok Indah Mall (PIM 1/2/3)', road: 'Jl. Metro Pondok Indah', kelurahan: 'Pondok Pinang', kecamatan: 'Kebayoran Lama', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Pondok Pinang, Kebayoran Lama, Jakarta Selatan', lat: -6.2655, lon: 106.7844, keywords: 'pim pondok indah' },
  { id: 'poi-kemang-village', nama: 'Lippo Mall Kemang', road: 'Jl. Pangeran Antasari', kelurahan: 'Bangka', kecamatan: 'Mampang Prapatan', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Jl. Pangeran Antasari, Kemang, Jakarta Selatan', lat: -6.2615, lon: 106.8124, keywords: 'kemvil kemang antasari' },
  { id: 'poi-cilandak-town-square', nama: 'Cilandak Town Square (Citos)', road: 'Jl. TB Simatupang', kelurahan: 'Cilandak Barat', kecamatan: 'Cilandak', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Jl. TB Simatupang, Cilandak, Jakarta Selatan', lat: -6.2916, lon: 106.7998, keywords: 'citos tb simatupang' },
  { id: 'poi-aeon-tanjung-barat', nama: 'AEON Mall Tanjung Barat', road: 'Jl. Raya Tanjung Barat', kelurahan: 'Tanjung Barat', kecamatan: 'Jagakarsa', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Jl. Raya Tanjung Barat, Jagakarsa, Jakarta Selatan', lat: -6.3061, lon: 106.8398, keywords: 'aeon lenteng agung pasar minggu' },
  { id: 'poi-central-park', nama: 'Central Park & Neo Soho', road: 'Jl. Letjen S. Parman', kelurahan: 'Tanjung Duren Selatan', kecamatan: 'Grogol Petamburan', city: 'Kota Jakarta Barat', province: 'DKI Jakarta', area: 'Jl. Letjen S. Parman, Tanjung Duren, Jakarta Barat', lat: -6.1774, lon: 106.7907, keywords: 'cp grogol podomoro city' },
  { id: 'poi-taman-anggrek', nama: 'Mall Taman Anggrek', road: 'Jl. Letjen S. Parman', kelurahan: 'Tanjung Duren Selatan', kecamatan: 'Grogol Petamburan', city: 'Kota Jakarta Barat', province: 'DKI Jakarta', area: 'Jl. Letjen S. Parman, Tanjung Duren, Jakarta Barat', lat: -6.1786, lon: 106.7922, keywords: 'mta grogol slipi' },
  { id: 'poi-puri-indah', nama: 'Puri Indah Mall & Lippo Mall Puri', road: 'Jl. Puri Agung', kelurahan: 'Kembangan Selatan', kecamatan: 'Kembangan', city: 'Kota Jakarta Barat', province: 'DKI Jakarta', area: 'Kembangan, Jakarta Barat', lat: -6.1886, lon: 106.7388, keywords: 'puri kembangan' },
  { id: 'poi-kota-tua', nama: 'Kawasan Kota Tua Jakarta', road: 'Jl. Taman Fatahillah', kelurahan: 'Pinangsia', kecamatan: 'Taman Sari', city: 'Kota Jakarta Barat', province: 'DKI Jakarta', area: 'Pinangsia, Taman Sari, Jakarta Barat', lat: -6.1352, lon: 106.8133, keywords: 'fatahillah glodok mangga dua' },
  { id: 'poi-kelapa-gading', nama: 'Mall Kelapa Gading (MKG)', road: 'Jl. Boulevard Raya', kelurahan: 'Kelapa Gading Timur', kecamatan: 'Kelapa Gading', city: 'Kota Jakarta Utara', province: 'DKI Jakarta', area: 'Kelapa Gading Timur, Jakarta Utara', lat: -6.1573, lon: 106.9082, keywords: 'mkg la piazza boulevard kelapa gading' },
  { id: 'poi-moi', nama: 'Mall of Indonesia (MOI)', road: 'Jl. Boulevard Barat Raya', kelurahan: 'Kelapa Gading Barat', kecamatan: 'Kelapa Gading', city: 'Kota Jakarta Utara', province: 'DKI Jakarta', area: 'Kelapa Gading Barat, Jakarta Utara', lat: -6.1516, lon: 106.8924, keywords: 'moi sunter kelapa gading' },
  { id: 'poi-pik-avenue', nama: 'PIK Avenue & Pantai Indah Kapuk', road: 'Jl. Pantai Indah Kapuk', kelurahan: 'Kamal Muara', kecamatan: 'Penjaringan', city: 'Kota Jakarta Utara', province: 'DKI Jakarta', area: 'Penjaringan, Jakarta Utara', lat: -6.1090, lon: 106.7405, keywords: 'pik 1 pik 2 pantjoran golf island' },
  { id: 'poi-ancol', nama: 'Taman Impian Jaya Ancol & Dufan', road: 'Jl. Lodan Timur', kelurahan: 'Ancol', kecamatan: 'Pademangan', city: 'Kota Jakarta Utara', province: 'DKI Jakarta', area: 'Pademangan, Jakarta Utara', lat: -6.1255, lon: 106.8307, keywords: 'ancol dufan pantai' },
  { id: 'poi-jis', nama: 'Jakarta International Stadium (JIS)', road: 'Jl. Sunter Permai Raya', kelurahan: 'Papanggo', kecamatan: 'Tanjung Priok', city: 'Kota Jakarta Utara', province: 'DKI Jakarta', area: 'Papanggo, Tanjung Priok, Jakarta Utara', lat: -6.1253, lon: 106.8605, keywords: 'jis sunter priok' },
  { id: 'poi-arion', nama: 'Arion Mall & Velodrome Rawamangun', road: 'Jl. Pemuda', kelurahan: 'Rawamangun', kecamatan: 'Pulo Gadung', city: 'Kota Jakarta Timur', province: 'DKI Jakarta', area: 'Jl. Pemuda, Rawamangun, Jakarta Timur', lat: -6.1942, lon: 106.8891, keywords: 'rawamangun pemuda' },
  { id: 'poi-bassura', nama: 'Mall Bassura City', road: 'Jl. Jend. Basuki Rahmat', kelurahan: 'Cipinang Besar Selatan', kecamatan: 'Jatinegara', city: 'Kota Jakarta Timur', province: 'DKI Jakarta', area: 'Jl. Jend. Basuki Rahmat, Jatinegara, Jakarta Timur', lat: -6.2255, lon: 106.8777, keywords: 'cipinang jatinegara' },
  { id: 'poi-tmii', nama: 'Taman Mini Indonesia Indah (TMII)', road: 'Jl. Raya Taman Mini', kelurahan: 'Ceger', kecamatan: 'Cipayung', city: 'Kota Jakarta Timur', province: 'DKI Jakarta', area: 'Cipayung, Jakarta Timur', lat: -6.3024, lon: 106.8952, keywords: 'tmii taman mini kramat jati' },

  // Stasiun, Bandara & Simpul Transportasi
  { id: 'st-gambir', nama: 'Stasiun Gambir', road: 'Jl. Medan Merdeka Timur', kelurahan: 'Gambir', kecamatan: 'Gambir', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Gambir, Jakarta Pusat', lat: -6.1767, lon: 106.8306, keywords: 'kereta api gambir monas' },
  { id: 'st-manggarai', nama: 'Stasiun Manggarai', road: 'Jl. Manggarai Utara', kelurahan: 'Manggarai', kecamatan: 'Tebet', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Manggarai, Tebet, Jakarta Selatan', lat: -6.2099, lon: 106.8502, keywords: 'krl manggarai tebet' },
  { id: 'st-sudirman', nama: 'Stasiun Sudirman & Dukuh Atas BNI City', road: 'Jl. Kendal', kelurahan: 'Menteng', kecamatan: 'Menteng', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Menteng, Jakarta Pusat', lat: -6.2024, lon: 106.8232, keywords: 'mrt lrt krl dukuh atas sudirman' },
  { id: 'st-pasar-senen', nama: 'Stasiun Pasar Senen', road: 'Jl. Pasar Senen', kelurahan: 'Senen', kecamatan: 'Senen', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Senen, Jakarta Pusat', lat: -6.1748, lon: 106.8454, keywords: 'senen kereta' },
  { id: 'st-tanah-abang', nama: 'Stasiun Tanah Abang', road: 'Jl. Jatibaru Raya', kelurahan: 'Cideng', kecamatan: 'Gambir', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Cideng, Tanah Abang, Jakarta Pusat', lat: -6.1856, lon: 106.8108, keywords: 'krl tanah abang' },
  { id: 'st-jakarta-kota', nama: 'Stasiun Jakarta Kota (Beos)', road: 'Jl. Stasiun Kota', kelurahan: 'Pinangsia', kecamatan: 'Taman Sari', city: 'Kota Jakarta Barat', province: 'DKI Jakarta', area: 'Pinangsia, Taman Sari, Jakarta Barat', lat: -6.1376, lon: 106.8146, keywords: 'kota tua beos' },
  { id: 'st-cawang', nama: 'Stasiun & Simpang Cawang', road: 'Jl. Letjen M.T. Haryono', kelurahan: 'Cawang', kecamatan: 'Kramat Jati', city: 'Kota Jakarta Timur', province: 'DKI Jakarta', area: 'Cawang, Kramat Jati, Jakarta Timur', lat: -6.2426, lon: 106.8588, keywords: 'lrt cawang mt haryono' },
  { id: 'st-lebak-bulus', nama: 'Stasiun MRT Lebak Bulus Grab', road: 'Jl. R.A. Kartini', kelurahan: 'Lebak Bulus', kecamatan: 'Cilandak', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Lebak Bulus, Cilandak, Jakarta Selatan', lat: -6.2894, lon: 106.7749, keywords: 'mrt lebak bulus ciputat' },
  { id: 'air-soetta', nama: 'Bandara Internasional Soekarno-Hatta (CGK)', road: 'Kawasan Bandara Soekarno-Hatta', kelurahan: 'Pajang', kecamatan: 'Benda', city: 'Kota Tangerang', province: 'Banten', area: 'Tangerang, Banten', lat: -6.1256, lon: 106.6559, keywords: 'bandara soetta cengkareng terminal 1 2 3' },
  { id: 'air-halim', nama: 'Bandara Halim Perdanakusuma & Stasiun Whoosh Halim', road: 'Jl. Halim Perdanakusuma', kelurahan: 'Halim Perdanakusuma', kecamatan: 'Makasar', city: 'Kota Jakarta Timur', province: 'DKI Jakarta', area: 'Makasar, Jakarta Timur', lat: -6.2666, lon: 106.8912, keywords: 'halim kcjb whoosh kereta cepat' },

  // Koridor Jalan & Kawasan Utama
  { id: 'jl-sudirman', nama: 'Jl. Jenderal Sudirman', road: 'Jl. Jenderal Sudirman', kelurahan: 'Karet Tengsin', kecamatan: 'Tanah Abang', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Jakarta Pusat - Jakarta Selatan', lat: -6.2146, lon: 106.8211, keywords: 'semanggi bendungan hilir setiabudi jalan jenderal sudirman' },
  { id: 'jl-thamrin', nama: 'Jl. M.H. Thamrin', road: 'Jl. M.H. Thamrin', kelurahan: 'Menteng', kecamatan: 'Menteng', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Menteng, Jakarta Pusat', lat: -6.1912, lon: 106.8229, keywords: 'thamrin kebon sirih jalan mh thamrin' },
  { id: 'jl-gatot-subroto', nama: 'Jl. Jenderal Gatot Subroto', road: 'Jl. Jenderal Gatot Subroto', kelurahan: 'Kuningan Timur', kecamatan: 'Setiabudi', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Kuningan - Semanggi - Pancoran, Jakarta Selatan', lat: -6.2361, lon: 106.8266, keywords: 'gatsu semanggi pancoran jalan gatot subroto' },
  { id: 'jl-rasuna-said', nama: 'Jl. H.R. Rasuna Said (Kuningan)', road: 'Jl. H.R. Rasuna Said', kelurahan: 'Karet Kuningan', kecamatan: 'Setiabudi', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Setiabudi, Kuningan, Jakarta Selatan', lat: -6.2216, lon: 106.8322, keywords: 'kuningan setiabudi jalan rasuna said' },
  { id: 'jl-mt-haryono', nama: 'Jl. Letjen M.T. Haryono', road: 'Jl. Letjen M.T. Haryono', kelurahan: 'Tebet Timur', kecamatan: 'Tebet', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Tebet - Cawang, Jakarta Selatan', lat: -6.2432, lon: 106.8531, keywords: 'pancoran cawang jalan mt haryono' },
  { id: 'jl-tb-simatupang', nama: 'Jl. TB Simatupang', road: 'Jl. TB Simatupang', kelurahan: 'Cilandak Timur', kecamatan: 'Pasar Minggu', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Cilandak - Pasar Minggu, Jakarta Selatan', lat: -6.2920, lon: 106.8139, keywords: 'fatmawati ampera ragunan jalan tb simatupang' },
  { id: 'jl-wahid-hasyim', nama: 'Jl. K.H. Wahid Hasyim', road: 'Jl. K.H. Wahid Hasyim', kelurahan: 'Kebon Sirih', kecamatan: 'Menteng', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Menteng - Tanah Abang, Jakarta Pusat', lat: -6.1881, lon: 106.8205, keywords: 'sabang menteng jalan wahid hasyim' },
  { id: 'jl-mas-mansyur', nama: 'Jl. K.H. Mas Mansyur', road: 'Jl. K.H. Mas Mansyur', kelurahan: 'Karet Tengsin', kecamatan: 'Tanah Abang', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Tanah Abang - Karet Tengsin, Jakarta Pusat', lat: -6.2015, lon: 106.8155, keywords: 'karet tanah abang jalan mas mansyur' },
  { id: 'jl-kemang-raya', nama: 'Jl. Kemang Raya', road: 'Jl. Kemang Raya', kelurahan: 'Bangka', kecamatan: 'Mampang Prapatan', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta', area: 'Bangka, Mampang Prapatan, Jakarta Selatan', lat: -6.2607, lon: 106.8137, keywords: 'kemang timur mampang jalan kemang raya' },
  { id: 'jl-daan-mogot', nama: 'Jl. Daan Mogot', road: 'Jl. Daan Mogot', kelurahan: 'Jelambar', kecamatan: 'Grogol Petamburan', city: 'Kota Jakarta Barat', province: 'DKI Jakarta', area: 'Grogol - Kalideres, Jakarta Barat', lat: -6.1563, lon: 106.7577, keywords: 'cengkareng grogol kalideres jalan daan mogot' },
  { id: 'jl-pramuka', nama: 'Jl. Pramuka & Matraman', road: 'Jl. Pramuka', kelurahan: 'Palmeriam', kecamatan: 'Matraman', city: 'Kota Jakarta Timur', province: 'DKI Jakarta', area: 'Matraman - Cempaka Putih, Jakarta Pusat/Timur', lat: -6.1928, lon: 106.8639, keywords: 'salemba matraman rawamangun jalan pramuka' },
  { id: 'jl-gunung-sahari', nama: 'Jl. Gunung Sahari & Kemayoran', road: 'Jl. Gunung Sahari', kelurahan: 'Gunung Sahari Utara', kecamatan: 'Sawah Besar', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Kemayoran - Sawah Besar, Jakarta Pusat', lat: -6.1568, lon: 106.8394, keywords: 'jiexpo kemayoran pasar baru jalan gunung sahari' },

  // Kampus, Rumah Sakit & Kota Penyangga
  { id: 'edu-ui-salemba', nama: 'Universitas Indonesia (Kampus Salemba) & RSCM', road: 'Jl. Salemba Raya', kelurahan: 'Kenari', kecamatan: 'Senen', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta', area: 'Salemba, Senen, Jakarta Pusat', lat: -6.1955, lon: 106.8490, keywords: 'ui salemba rscm cipto mangunkusumo' },
  { id: 'edu-ui-depok', nama: 'Universitas Indonesia (Kampus UI Depok)', road: 'Jl. Margonda Raya', kelurahan: 'Pondok Cina', kecamatan: 'Beji', city: 'Kota Depok', province: 'Jawa Barat', area: 'Beji, Depok, Jawa Barat', lat: -6.3617, lon: 106.8272, keywords: 'ui depok margonda' },
  { id: 'edu-binus', nama: 'Universitas Bina Nusantara (BINUS Kemanggisan)', road: 'Jl. K.H. Syahdan', kelurahan: 'Kemanggisan', kecamatan: 'Palmerah', city: 'Kota Jakarta Barat', province: 'DKI Jakarta', area: 'Kebon Jeruk, Palmerah, Jakarta Barat', lat: -6.2018, lon: 106.7823, keywords: 'binus anggrek syahdan' },
  { id: 'edu-trisakti', nama: 'Universitas Trisakti & UNTAR', road: 'Jl. Kyai Tapa', kelurahan: 'Tomang', kecamatan: 'Grogol Petamburan', city: 'Kota Jakarta Barat', province: 'DKI Jakarta', area: 'Jl. Kyai Tapa, Grogol, Jakarta Barat', lat: -6.1675, lon: 106.7901, keywords: 'trisakti tarumanagara grogol' },
  { id: 'sat-bsd', nama: 'BSD City & AEON Mall BSD', road: 'Jl. BSD Grand Boulevard', kelurahan: 'Sampora', kecamatan: 'Cisauk', city: 'Kabupaten Tangerang', province: 'Banten', area: 'Serpong, Tangerang Selatan', lat: -6.3016, lon: 106.6435, keywords: 'bsd serpong ice bsd' },
  { id: 'sat-bintaro', nama: 'Bintaro Jaya Xchange (BXc)', road: 'Boulevard Bintaro Jaya', kelurahan: 'Pondok Jaya', kecamatan: 'Pondok Aren', city: 'Kota Tangerang Selatan', province: 'Banten', area: 'Pondok Aren, Tangerang Selatan', lat: -6.2852, lon: 106.7279, keywords: 'bintaro sektor 7 sektor 9' },
  { id: 'sat-alam-sutera', nama: 'Alam Sutera & Mall @ Alam Sutera', road: 'Jl. Jalur Sutera Barat', kelurahan: 'Panunggangan Timur', kecamatan: 'Pinang', city: 'Kota Tangerang', province: 'Banten', area: 'Pinang, Tangerang', lat: -6.2233, lon: 106.6531, keywords: 'alsut ikea alam sutera' },
  { id: 'sat-summarecon-bekasi', nama: 'Summarecon Mall Bekasi', road: 'Jl. Boulevard Ahmad Yani', kelurahan: 'Marga Mulya', kecamatan: 'Bekasi Utara', city: 'Kota Bekasi', province: 'Jawa Barat', area: 'Bekasi Utara, Kota Bekasi', lat: -6.2260, lon: 107.0010, keywords: 'smb bekasi barat' },
];

/**
 * Mencari kecocokan pada katalog lokal Jakarta & Jabodetabek,
 * sekaligus menggabungkan kembali micro-unit (Blok/No/RT/RW/Kav) jika diketik oleh pengguna.
 */
function matchLocalGazetteer(rawQuery, deconstructed, limit = 6) {
  const candidates = [rawQuery, ...(deconstructed?.searchCandidates || [])]
    .map((s) => String(s || '').trim().toLowerCase())
    .filter(Boolean);
  if (candidates.length === 0) return [];

  const scored = [];
  for (const item of JAKARTA_GAZETTEER) {
    const namaLower = item.nama.toLowerCase();
    const areaLower = item.area.toLowerCase();
    const haystack = `${namaLower} ${areaLower} ${item.keywords || ''}`.toLowerCase();

    let bestScore = 0;
    for (const q of candidates) {
      const tokens = q.split(/\s+/).filter(Boolean);
      let score = 0;
      if (namaLower === q) score = 100;
      else if (namaLower.startsWith(q)) score = 80;
      else if (namaLower.includes(q)) score = 60;
      else if (haystack.includes(q)) score = 40;
      else if (tokens.length > 1 && tokens.every((t) => haystack.includes(t))) score = 35;
      if (score > bestScore) bestScore = score;
    }

    if (bestScore > 0) {
      scored.push({ score: bestScore, item });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => {
      if (deconstructed?.microUnit || deconstructed?.estateOrComplex) {
        return composeDetailedIndonesianLocation(
          {
            name: item.nama,
            road: item.road || '',
            kelurahan: item.kelurahan || '',
            kecamatan: item.kecamatan || '',
            city: item.city || '',
            province: item.province || 'DKI Jakarta',
            lat: item.lat,
            lon: item.lon,
            sourceId: item.id,
          },
          deconstructed
        );
      }
      return {
        id: item.id,
        headline: item.nama,
        subtitle: item.area,
        formatted: `${item.nama}, ${item.area}`,
        nama: item.nama,
        area: item.area,
        alamatLengkap: `${item.nama}, ${item.area}`,
        lat: item.lat,
        lon: item.lon,
      };
    });
}

/**
 * Helper fetch dengan batas waktu ketat agar tidak pernah menggantung koneksi proxy.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provider 1: Google Maps Geocoding API (jika GOOGLE_MAPS_API_KEY tersedia)
 */
async function queryGoogleGeocoder(candidate, deconstructed, googleKey) {
  if (!googleKey) return [];
  const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(candidate)}&components=country:ID&language=id&key=${encodeURIComponent(googleKey)}`;
  const gRes = await fetchWithTimeout(gUrl);
  if (!gRes.ok) return [];
  const gData = await gRes.json();
  if (gData.status !== 'OK' || !Array.isArray(gData.results)) return [];

  return gData.results
    .slice(0, 6)
    .map((item, idx) => {
      const loc = item.geometry?.location || {};
      const comps = Array.isArray(item.address_components) ? item.address_components : [];
      const getComp = (...types) =>
        comps.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || '';

      const road = getComp('route');
      const residential = getComp('neighborhood', 'sublocality_level_2', 'premise', 'point_of_interest', 'establishment');
      const kelurahan = getComp('administrative_area_level_4', 'sublocality_level_1', 'sublocality');
      const kecamatan = getComp('administrative_area_level_3');
      const city = getComp('administrative_area_level_2', 'locality');
      const province = getComp('administrative_area_level_1');
      const firstPart = String(item.formatted_address || '').split(',')[0]?.trim() || '';

      return composeDetailedIndonesianLocation(
        {
          name: residential || firstPart,
          road,
          residential,
          kelurahan,
          kecamatan,
          city,
          province,
          lat: Number(loc.lat),
          lon: Number(loc.lng),
          sourceId: `gmaps-${item.place_id || idx}`,
        },
        deconstructed
      );
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * Provider 2: OpenStreetMap Nominatim (Deep Address Hierarchy: Kelurahan, Kecamatan, Kota)
 */
async function queryNominatimGeocoder(candidate, deconstructed) {
  const viewbox = `${JABODETABEK_BOUNDS.minLon},${JABODETABEK_BOUNDS.maxLat},${JABODETABEK_BOUNDS.maxLon},${JABODETABEK_BOUNDS.minLat}`;
  const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&namedetails=1&countrycodes=id&viewbox=${viewbox}&limit=6&q=${encodeURIComponent(candidate)}`;
  const nRes = await fetchWithTimeout(nomUrl, {
    headers: {
      'User-Agent': 'JakSafe-Navigation-App/1.0',
      'Accept-Language': 'id,en',
    },
  });
  if (!nRes.ok) return [];
  const nData = await nRes.json();
  if (!Array.isArray(nData)) return [];

  return nData
    .map((item) => {
      const a = item.address || {};
      return composeDetailedIndonesianLocation(
        {
          name: item.name || item.namedetails?.name || '',
          residential: a.residential || a.neighbourhood || a.quarter || a.hamlet || a.amenity || a.building || a.office || a.shop || '',
          road: a.road || a.pedestrian || a.street || a.footway || '',
          kelurahan: a.village || a.suburb || '',
          kecamatan: a.city_district || a.municipality || a.town || '',
          city: a.city || a.county || a.state_district || '',
          province: a.state || a.province || a.region || '',
          lat: Number(item.lat),
          lon: Number(item.lon),
          sourceId: `osm-${item.place_id}`,
        },
        deconstructed
      );
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * Provider 3: OpenStreetMap Photon (Fast Prefix Autocomplete with Bounding Box)
 */
async function queryPhotonGeocoder(candidate, deconstructed) {
  const bbox = `${ID_BOUNDS.minLon},${ID_BOUNDS.minLat},${ID_BOUNDS.maxLon},${ID_BOUNDS.maxLat}`;
  const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(candidate)}&lat=-6.2088&lon=106.8456&bbox=${bbox}&limit=6`;
  const pRes = await fetchWithTimeout(photonUrl, {
    headers: { 'User-Agent': 'JakSafe-Navigation-App/1.0' },
  });
  if (!pRes.ok) return [];
  const pData = await pRes.json();
  const features = Array.isArray(pData?.features) ? pData.features : [];

  return features
    .filter((f) => !f.properties?.countrycode || f.properties.countrycode.toUpperCase() === 'ID')
    .map((f, idx) => {
      const p = f.properties || {};
      const [lon, lat] = f.geometry?.coordinates || [NaN, NaN];
      return composeDetailedIndonesianLocation(
        {
          name: p.name || '',
          road: p.street || '',
          residential: p.osm_key === 'landuse' ? p.name : '',
          neighbourhood: p.district || '',
          kelurahan: p.locality || '',
          kecamatan: p.district || '',
          city: p.city || p.county || '',
          province: p.state || '',
          lat: Number(lat),
          lon: Number(lon),
          sourceId: `photon-${p.osm_id || idx}`,
        },
        deconstructed
      );
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * Provider 4: ArcGIS World Geocoding Service (CDN global IPv4, cepat di Indonesia, tanpa API key)
 */
async function queryArcGisGeocoder(candidate, deconstructed) {
  const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates`
    + `?SingleLine=${encodeURIComponent(candidate)}&countryCode=IDN&location=106.8272,-6.1754`
    + `&outFields=PlaceName,Place_addr,StName,Nbrhd,District,City,Subregion,Region,Type&maxLocations=6&f=json`;
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'JakSafe-Navigation-App/1.0' },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

  return candidates
    .map((c, idx) => {
      const attrs = c.attributes || {};
      const rawAddr = String(attrs.Place_addr || c.address || '').trim();
      const parts = rawAddr.split(',').map((s) => s.trim()).filter(Boolean);
      const placeName = attrs.PlaceName || parts[0] || c.address || candidate;
      const lat = Number(c.location?.y);
      const lon = Number(c.location?.x);

      return composeDetailedIndonesianLocation(
        {
          name: placeName,
          road: attrs.StName || '',
          kelurahan: attrs.Nbrhd || parts[1] || '',
          kecamatan: attrs.District || parts[2] || '',
          city: attrs.City || attrs.Subregion || parts[3] || '',
          province: attrs.Region || '',
          lat,
          lon,
          sourceId: `arcgis-${idx}-${lat.toFixed(4)}-${lon.toFixed(4)}`,
        },
        deconstructed
      );
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

/**
 * Menggabungkan daftar tempat tanpa duplikasi nama/lokasi yang berdekatan.
 */
function mergePlaces(lists, max = 8) {
  const merged = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) continue;
      const isDup = merged.some((existing) => {
        const sameName = existing.nama.toLowerCase() === item.nama.toLowerCase();
        const closeBy = Math.hypot(existing.lat - item.lat, existing.lon - item.lon) < 0.0025;
        return sameName && closeBy;
      });
      if (!isDup) {
        merged.push(item);
        if (merged.length >= max) return merged;
      }
    }
  }
  return merged;
}

/**
 * Reverse Geocoding: Menerjemahkan koordinat GPS { lat, lon } menjadi alamat jalan/kelurahan/kecamatan
 * sesuai spesifikasi Kalceria (resolveIndonesianReverseGeo).
 */
router.get('/reverse', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon ?? req.query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ ok: false, error: 'Koordinat lat dan lon yang valid diperlukan' });
  }

  if (!isWithinIndonesiaBounds(lat, lon)) {
    return res.status(422).json({
      ok: false,
      error: 'Koordinat berada di luar wilayah layanan Indonesia',
    });
  }

  const cacheKey = `rev:${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) {
    return res.json(cached.payload);
  }

  const deconstructed = { estateOrComplex: '', microUnit: '' };
  let resolved = null;

  // 1. Primary: Nominatim Reverse Geocode
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${lat}&lon=${lon}`;
    const resp = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'JakSafe-Navigation-App/1.0',
        'Accept-Language': 'id,en',
        Accept: 'application/json',
      },
    }, 2400);

    if (resp.ok) {
      const data = await resp.json();
      const a = data.address || {};
      resolved = composeDetailedIndonesianLocation(
        {
          name: a.amenity || a.building || a.office || a.residential || a.neighbourhood || '',
          road: a.road || a.pedestrian || a.street || a.residential || '',
          kelurahan: a.village || a.suburb || '',
          kecamatan: a.city_district || a.municipality || a.town || '',
          city: a.city || a.county || '',
          province: a.state || a.province || '',
          lat,
          lon,
          sourceId: `osm-rev-${data.place_id || `${lat.toFixed(4)}-${lon.toFixed(4)}`}`,
        },
        deconstructed
      );
    }
  } catch {
    // Lanjut ke Photon/ArcGIS
  }

  // 2. Secondary Fallback: Photon Reverse Geocode
  if (!resolved) {
    try {
      const photonUrl = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`;
      const resp = await fetchWithTimeout(photonUrl, {}, 2000);
      if (resp.ok) {
        const data = await resp.json();
        const p = data?.features?.[0]?.properties;
        if (p) {
          resolved = composeDetailedIndonesianLocation(
            {
              name: p.name || '',
              road: p.street || '',
              kelurahan: p.locality || '',
              kecamatan: p.district || '',
              city: p.city || p.county || '',
              province: p.state || '',
              lat,
              lon,
              sourceId: `photon-rev-${p.osm_id || `${lat.toFixed(4)}-${lon.toFixed(4)}`}`,
            },
            deconstructed
          );
        }
      }
    } catch {
      // Lanjut ke fallback terdekat
    }
  }

  // 3. Fallback ke lokasi terdekat di Gazetteer bila layanan luar sedang offline
  if (!resolved) {
    let bestItem = JAKARTA_GAZETTEER[0];
    let bestDist = Infinity;
    for (const item of JAKARTA_GAZETTEER) {
      const d = Math.hypot(item.lat - lat, item.lon - lon);
      if (d < bestDist) {
        bestDist = d;
        bestItem = item;
      }
    }
    resolved = composeDetailedIndonesianLocation(
      {
        name: `Sekitar ${bestItem.nama}`,
        road: bestItem.road || '',
        kelurahan: bestItem.kelurahan || '',
        kecamatan: bestItem.kecamatan || '',
        city: bestItem.city || '',
        province: bestItem.province || 'DKI Jakarta',
        lat,
        lon,
        sourceId: `gps-${lat.toFixed(4)}-${lon.toFixed(4)}`,
      },
      deconstructed
    );
  }

  const payload = {
    ok: true,
    place: resolved,
    ...resolved,
  };
  geocodeCache.set(cacheKey, { payload, at: Date.now() });
  return res.json(payload);
});

/**
 * Endpoint Geocoding Utama: Menerjemahkan nama jalan, perumahan, blok/nomor rumah,
 * gedung, mall, atau koordinat angka menjadi daftar lokasi presisi { lat, lon }.
 */
router.get('/', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ ok: false, error: 'Query q diperlukan' });
  }

  // 1. Cek apakah pengguna langsung mengetik koordinat angka
  const coordMatch = query.match(/^([-+]?\d{1,2}(?:\.\d+)?)[,\s]+([-+]?\d{1,3}(?:\.\d+)?)$/);
  if (coordMatch) {
    const a = Number(coordMatch[1]);
    const b = Number(coordMatch[2]);
    const lat = Math.abs(a) <= 90 && a < 15 ? a : b;
    const lon = lat === a ? b : a;
    return res.json({
      ok: true,
      source: 'coordinate',
      places: [
        {
          id: `coord-${lat.toFixed(4)}-${lon.toFixed(4)}`,
          headline: `Titik Koordinat [${lat.toFixed(4)}, ${lon.toFixed(4)}]`,
          subtitle: 'Koordinat Kustom',
          formatted: `Titik Koordinat [${lat.toFixed(4)}, ${lon.toFixed(4)}], Koordinat Kustom`,
          nama: `Titik Koordinat [${lat.toFixed(4)}, ${lon.toFixed(4)}]`,
          area: 'Koordinat Kustom',
          lat,
          lon,
        },
      ],
    });
  }

  const cacheKey = `v2:${query.toLowerCase()}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) {
    return res.json(cached.payload);
  }

  // 2. Dekonstruksi alamat Indonesia sesuai spesifikasi Kalceria
  const deconstructed = deconstructIndonesianAddress(query);
  const hasGranularDetail = Boolean(
    deconstructed.microUnit ||
    deconstructed.estateOrComplex ||
    query.includes(',') ||
    /\b(?:jl|jln|jalan|gg|gang|rt|rw|blok|no|nomor|kav|cluster|perum|perumahan|komplek|apartemen)\b/i.test(query)
  );

  // 3. Kecocokan katalog lokal Jakarta & Jabodetabek (instan 0ms)
  const localMatches = matchLocalGazetteer(query, deconstructed, 6);

  // Hanya short-circuit ke katalog lokal jika kueri sangat pendek (< 3 huruf)
  // dan tidak mengandung detail jalan/perumahan/blok
  if (query.length < 3 && !hasGranularDetail && localMatches.length > 0) {
    const payload = { ok: true, source: 'jakarta-gazetteer', places: localMatches };
    geocodeCache.set(cacheKey, { payload, at: Date.now() });
    return res.json(payload);
  }

  const googleKey = process.env.GOOGLE_MAPS_API_KEY || '';
  const remoteCandidates = [];
  let source = 'jakarta-gazetteer';

  // 4. Telusuri kandidat pencarian hasil dekonstruksi (dari paling spesifik ke umum)
  const searchList = deconstructed.searchCandidates.length > 0
    ? deconstructed.searchCandidates.slice(0, 3)
    : [query];

  for (const candidate of searchList) {
    const tasks = [
      queryNominatimGeocoder(candidate, deconstructed),
      queryPhotonGeocoder(candidate, deconstructed),
      queryArcGisGeocoder(candidate, deconstructed),
    ];
    if (googleKey) {
      tasks.unshift(queryGoogleGeocoder(candidate, deconstructed, googleKey));
    }

    const settled = await Promise.allSettled(tasks);
    const batchLists = settled
      .filter((r) => r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0)
      .map((r) => r.value);

    if (batchLists.length > 0) {
      const mergedBatch = mergePlaces(batchLists, 8);
      remoteCandidates.push(...mergedBatch);
      source = googleKey && settled[0].status === 'fulfilled' && settled[0].value?.length > 0
        ? 'google-kalceria-parser'
        : 'osm-kalceria-parser';
    }

    if (remoteCandidates.length >= 5) break;
  }

  // Jika pengguna mengetik detail spesifik (jalan/perumahan/blok/koma), prioritaskan hasil geocoder presisi di atas POI umum
  const orderedLists = hasGranularDetail
    ? [remoteCandidates, localMatches]
    : [localMatches, remoteCandidates];

  const finalPlaces = mergePlaces(orderedLists, 8);
  const payload = {
    ok: true,
    source: finalPlaces.length > 0 ? source : 'none',
    deconstructed: {
      estateOrComplex: deconstructed.estateOrComplex,
      microUnit: deconstructed.microUnit,
      searchCandidates: deconstructed.searchCandidates,
    },
    places: finalPlaces,
  };

  if (finalPlaces.length > 0) {
    geocodeCache.set(cacheKey, { payload, at: Date.now() });
    if (geocodeCache.size > CACHE_MAX) {
      geocodeCache.delete(geocodeCache.keys().next().value);
    }
  }

  return res.json(payload);
});

export default router;
