// Indian states/UTs with GST state codes and major city lists.
// GST state codes are per official GSTN/Income Tax classification.

export interface IndiaState {
  name: string;
  code: string; // zero-padded two-digit GST code
}

export const INDIA_STATES: IndiaState[] = [
  { name: "Jammu & Kashmir",          code: "01" },
  { name: "Himachal Pradesh",         code: "02" },
  { name: "Punjab",                   code: "03" },
  { name: "Chandigarh",               code: "04" },
  { name: "Uttarakhand",              code: "05" },
  { name: "Haryana",                  code: "06" },
  { name: "Delhi",                    code: "07" },
  { name: "Rajasthan",                code: "08" },
  { name: "Uttar Pradesh",            code: "09" },
  { name: "Bihar",                    code: "10" },
  { name: "Sikkim",                   code: "11" },
  { name: "Arunachal Pradesh",        code: "12" },
  { name: "Nagaland",                 code: "13" },
  { name: "Manipur",                  code: "14" },
  { name: "Mizoram",                  code: "15" },
  { name: "Tripura",                  code: "16" },
  { name: "Meghalaya",                code: "17" },
  { name: "Assam",                    code: "18" },
  { name: "West Bengal",              code: "19" },
  { name: "Jharkhand",                code: "20" },
  { name: "Odisha",                   code: "21" },
  { name: "Chhattisgarh",             code: "22" },
  { name: "Madhya Pradesh",           code: "23" },
  { name: "Gujarat",                  code: "24" },
  { name: "Daman & Diu",              code: "25" },
  { name: "Dadra & Nagar Haveli",     code: "26" },
  { name: "Maharashtra",              code: "27" },
  { name: "Andhra Pradesh",           code: "28" },
  { name: "Karnataka",                code: "29" },
  { name: "Goa",                      code: "30" },
  { name: "Lakshadweep",              code: "31" },
  { name: "Kerala",                   code: "32" },
  { name: "Tamil Nadu",               code: "33" },
  { name: "Puducherry",               code: "34" },
  { name: "Andaman & Nicobar Islands",code: "35" },
  { name: "Telangana",                code: "36" },
  { name: "Andhra Pradesh (New)",     code: "37" },
  { name: "Ladakh",                   code: "38" },
];

// Alias table so legacy spellings resolve correctly.
const STATE_ALIASES: Record<string, string> = {
  "j&k":                         "Jammu & Kashmir",
  "j & k":                       "Jammu & Kashmir",
  "jammu and kashmir":            "Jammu & Kashmir",
  "hp":                           "Himachal Pradesh",
  "uk":                           "Uttarakhand",
  "uttaranchal":                  "Uttarakhand",
  "new delhi":                    "Delhi",
  "up":                           "Uttar Pradesh",
  "wb":                           "West Bengal",
  "mp":                           "Madhya Pradesh",
  "ap":                           "Andhra Pradesh",
  "tn":                           "Tamil Nadu",
  "pondy":                        "Puducherry",
  "pondicherry":                  "Puducherry",
  "andaman":                      "Andaman & Nicobar Islands",
  "a&n":                          "Andaman & Nicobar Islands",
  "dnhdd":                        "Dadra & Nagar Haveli",
  "dadra":                        "Dadra & Nagar Haveli",
  "daman":                        "Daman & Diu",
};

export function getStateCode(stateName: string): string {
  if (!stateName) return "";
  const normalized = stateName.trim();
  const direct = INDIA_STATES.find(
    s => s.name.toLowerCase() === normalized.toLowerCase()
  );
  if (direct) return direct.code;
  const alias = STATE_ALIASES[normalized.toLowerCase()];
  if (alias) {
    const via = INDIA_STATES.find(s => s.name.toLowerCase() === alias.toLowerCase());
    if (via) return via.code;
  }
  return "";
}

export function getStateName(code: string): string {
  if (!code) return "";
  const padded = String(code).trim().padStart(2, "0");
  return INDIA_STATES.find(s => s.code === padded)?.name ?? "";
}

// ── City list (state → cities, alphabetically sorted) ────────────────────────
// Covers tier-1, tier-2, and major tier-3 towns for each state.

export const CITIES_BY_STATE: Record<string, string[]> = {
  "Andhra Pradesh": [
    "Amaravati","Anantapur","Bhimavaram","Chittoor","Eluru","Guntur","Hindupur","Kadapa","Kakinada","Kurnool","Machilipatnam","Nandyal","Nellore","Ongole","Proddatur","Rajahmundry","Srikakulam","Tirupati","Vijayawada","Visakhapatnam","Vizianagaram",
  ],
  "Andhra Pradesh (New)": [
    "Amaravati","Anantapur","Bhimavaram","Chittoor","Eluru","Guntur","Hindupur","Kadapa","Kakinada","Kurnool","Machilipatnam","Nandyal","Nellore","Ongole","Proddatur","Rajahmundry","Tirupati","Vijayawada","Visakhapatnam",
  ],
  "Arunachal Pradesh": [
    "Itanagar","Naharlagun","Pasighat","Tezpur","Ziro",
  ],
  "Assam": [
    "Bongaigaon","Dhubri","Dibrugarh","Guwahati","Jorhat","Nagaon","Nalbari","Silchar","Sivasagar","Tezpur","Tinsukia",
  ],
  "Bihar": [
    "Arrah","Araria","Aurangabad","Begusarai","Bhagalpur","Bihar Sharif","Buxar","Chapra","Darbhanga","Gaya","Hajipur","Katihar","Kishanganj","Munger","Muzaffarpur","Patna","Purnia","Saharsa","Sasaram","Siwan",
  ],
  "Chandigarh": [
    "Chandigarh",
  ],
  "Chhattisgarh": [
    "Ambikapur","Bhilai","Bilaspur","Dhamtari","Durg","Jagdalpur","Korba","Raigarh","Raipur","Rajnandgaon",
  ],
  "Dadra & Nagar Haveli": [
    "Silvassa",
  ],
  "Daman & Diu": [
    "Daman","Diu",
  ],
  "Delhi": [
    "Connaught Place","Dwarka","Greater Kailash","Janakpuri","Karol Bagh","Lajpat Nagar","Laxmi Nagar","Nehru Place","New Delhi","Noida (NCR)","Preet Vihar","Punjabi Bagh","Rohini","Saket","Sarojini Nagar","South Extension","Vasant Kunj","Vasant Vihar",
  ],
  "Goa": [
    "Madgaon","Mapusa","Margao","Panaji","Ponda","Vasco da Gama",
  ],
  "Gujarat": [
    "Ahmedabad","Amreli","Anand","Ankleshwar","Bharuch","Bhavnagar","Bhuj","Botad","Dahod","Gandhinagar","Gandhidham","Godhra","Jamnagar","Junagadh","Kheda","Mehsana","Morbi","Navsari","Porbandar","Rajkot","Surat","Surendranagar","Vadodara","Valsad","Vapi",
  ],
  "Haryana": [
    "Ambala","Bahadurgarh","Bhiwani","Faridabad","Fatehabad","Gurgaon","Gurugram","Hisar","Jhajjar","Jind","Kaithal","Karnal","Kurukshetra","Mahendragarh","Manesar","Nuh","Palwal","Panchkula","Panipat","Rewari","Rohtak","Sirsa","Sonipat","Yamuna Nagar",
  ],
  "Himachal Pradesh": [
    "Baddi","Bilaspur","Chamba","Dharamshala","Hamirpur","Kangra","Kullu","Manali","Mandi","Nahan","Shimla","Solan","Una",
  ],
  "Jammu & Kashmir": [
    "Anantnag","Baramulla","Jammu","Kathua","Kulgam","Pulwama","Rajouri","Sopore","Srinagar","Udhampur",
  ],
  "Jharkhand": [
    "Bokaro","Deoghar","Dhanbad","Dumka","Giridih","Hazaribagh","Jamshedpur","Jharia","Ranchi",
  ],
  "Karnataka": [
    "Bagalkot","Ballari","Belagavi","Bellary","Bengaluru","Bidar","Bijapur","Chikkaballapur","Chikkamagaluru","Chitradurga","Davanagere","Dharwad","Gadag","Hassan","Haveri","Hubballi","Kalaburagi","Kodagu","Kolar","Koppal","Madikeri","Mandya","Mangaluru","Mysuru","Raichur","Ramanagara","Shivamogga","Tumakuru","Udupi","Vijayapura",
  ],
  "Kerala": [
    "Alappuzha","Attingal","Chalakudy","Ernakulam","Irinjalakuda","Kannur","Kasaragod","Kochi","Kollam","Kottayam","Kozhikode","Malappuram","Manjeri","Palakkad","Pathanamthitta","Perinthalmanna","Thalassery","Thiruvalla","Thiruvananthapuram","Thrissur","Tirur","Vadakara",
  ],
  "Ladakh": [
    "Kargil","Leh",
  ],
  "Lakshadweep": [
    "Kavaratti",
  ],
  "Madhya Pradesh": [
    "Balaghat","Bhind","Bhopal","Chhindwara","Datia","Dewas","Dhar","Guna","Gwalior","Indore","Itarsi","Jabalpur","Katni","Khandwa","Khargone","Mandla","Morena","Narsinghpur","Ratlam","Rewa","Sagar","Satna","Sehore","Seoni","Shahdol","Shivpuri","Singrauli","Ujjain","Vidisha",
  ],
  "Maharashtra": [
    "Ahmednagar","Akola","Amravati","Aurangabad","Baramati","Beed","Bhandara","Bhiwandi","Buldhana","Chandrapur","Dhule","Gondia","Hingoli","Jalgaon","Jalna","Kalyan","Kolhapur","Latur","Lonavala","Malegaon","Mumbai","Nagpur","Nanded","Nashik","Navi Mumbai","Navi Mumbai Panvel","Osmanabad","Palghar","Parbhani","Pune","Raigad","Ratnagiri","Sangli","Satara","Sindhudurg","Solapur","Thane","Wardha","Washim","Yavatmal",
  ],
  "Manipur": [
    "Bishnupur","Churachandpur","Imphal","Senapati","Thoubal",
  ],
  "Meghalaya": [
    "Jowai","Nongpoh","Shillong","Tura",
  ],
  "Mizoram": [
    "Aizawl","Champhai","Lunglei",
  ],
  "Nagaland": [
    "Dimapur","Kohima","Mokokchung","Tuensang",
  ],
  "Odisha": [
    "Angul","Balasore","Baripada","Berhampur","Bhawanipatna","Bhubaneswar","Bolangir","Brahmapur","Cuttack","Dhenkanal","Jeypore","Kendujhar","Koraput","Puri","Rourkela","Sambalpur","Sundargarh",
  ],
  "Puducherry": [
    "Karaikal","Mahe","Puducherry","Yanam",
  ],
  "Punjab": [
    "Abohar","Amritsar","Barnala","Batala","Bathinda","Faridkot","Fatehgarh Sahib","Fazilka","Ferozepur","Gurdaspur","Hoshiarpur","Jalandhar","Kapurthala","Khanna","Ludhiana","Mansa","Moga","Mohali","Muktsar","Nawanshahr","Pathankot","Patiala","Phagwara","Ropar","Rupnagar","Sangrur","SAS Nagar","Tarn Taran",
  ],
  "Rajasthan": [
    "Ajmer","Alwar","Banswara","Baran","Barmer","Bharatpur","Bhilwara","Bikaner","Bundi","Chittorgarh","Churu","Dausa","Dholpur","Dungarpur","Ganganagar","Hanumangarh","Jaipur","Jaisalmer","Jalore","Jhalawar","Jhunjhunu","Jodhpur","Karauli","Kota","Nagaur","Pali","Pratapgarh","Rajsamand","Sawai Madhopur","Sikar","Sirohi","Tonk","Udaipur",
  ],
  "Sikkim": [
    "Gangtok","Geyzing","Mangan","Namchi",
  ],
  "Tamil Nadu": [
    "Ambattur","Ambur","Ariyalur","Chennai","Coimbatore","Cuddalore","Dharmapuri","Dindigul","Erode","Hosur","Kanchipuram","Karur","Krishnagiri","Kumbakonam","Madurai","Nagapattinam","Nagercoil","Namakkal","Nilgiris","Ooty","Perambalur","Pudukkottai","Ramanathapuram","Salem","Sivakasi","Tenkasi","Thanjavur","Theni","Thoothukudi","Tiruchirappalli","Tirunelveli","Tiruppur","Tiruvallur","Tiruvannamalai","Tiruvarur","Tuticorin","Vellore","Villupuram","Virudhunagar",
  ],
  "Telangana": [
    "Adilabad","Bhadradri Kothagudem","Hyderabad","Jagtial","Jangaon","Jayashankar Bhupalpally","Jogulamba Gadwal","Kamareddy","Karimnagar","Khammam","Komaram Bheem","Mahabubabad","Mahabubnagar","Mancherial","Medak","Medchal","Mulugu","Nalgonda","Narayanpet","Nirmal","Nizamabad","Peddapalli","Rajanna Sircilla","Ranga Reddy","Sangareddy","Secunderabad","Siddipet","Suryapet","Vikarabad","Wanaparthy","Warangal","Yadadri Bhuvanagiri",
  ],
  "Tripura": [
    "Agartala","Dharmanagar","Udaipur",
  ],
  "Uttarakhand": [
    "Dehradun","Haridwar","Haldwani","Kashipur","Kotdwar","Mussoorie","Nainital","Pantnagar","Rishikesh","Roorkee","Rudrapur","Srinagar (Garhwal)",
  ],
  "Uttar Pradesh": [
    "Agra","Aligarh","Allahabad","Ambedkar Nagar","Amethi","Amroha","Auraiya","Ayodhya","Azamgarh","Baghpat","Bahraich","Ballia","Balrampur","Banda","Barabanki","Bareilly","Basti","Bhadohi","Bijnor","Budaun","Bulandshahr","Chandauli","Chitrakoot","Deoria","Etah","Etawah","Farrukhabad","Fatehpur","Firozabad","Gautam Buddha Nagar","Ghaziabad","Ghazipur","Gonda","Gorakhpur","Hamirpur","Hapur","Hardoi","Hathras","Jalaun","Jaunpur","Jhansi","Kannauj","Kanpur","Kasganj","Kaushambi","Kushinagar","Lakhimpur Kheri","Lalitpur","Lucknow","Maharajganj","Mahoba","Mainpuri","Mathura","Mau","Meerut","Mirzapur","Moradabad","Muzaffarnagar","Noida","Pilibhit","Pratapgarh","Prayagraj","Raebareli","Rampur","Saharanpur","Sambhal","Sant Kabir Nagar","Shahjahanpur","Shamli","Shravasti","Siddharthnagar","Sitapur","Sonbhadra","Sultanpur","Unnao","Varanasi",
  ],
  "West Bengal": [
    "Alipurduar","Asansol","Bankura","Bardhaman","Birbhum","Cooch Behar","Darjeeling","Durgapur","Hooghly","Howrah","Jalpaiguri","Kalimpong","Kolkata","Malda","Midnapore","Murshidabad","Nadia","North 24 Parganas","Purulia","Siliguri","South 24 Parganas",
  ],
  "Andaman & Nicobar Islands": [
    "Port Blair",
  ],
};

// Flatten all cities for reverse-lookup (city → state).
// When multiple states share a city name, returns null (ambiguous).
const _cityToState = new Map<string, string | null>();
for (const [state, cities] of Object.entries(CITIES_BY_STATE)) {
  for (const city of cities) {
    const key = city.toLowerCase();
    if (_cityToState.has(key)) {
      _cityToState.set(key, null); // ambiguous
    } else {
      _cityToState.set(key, state);
    }
  }
}

export function getCitiesForState(stateName: string): string[] {
  if (!stateName) return [];
  // Direct match first
  const direct = CITIES_BY_STATE[stateName];
  if (direct) return direct;
  // Alias match
  const alias = STATE_ALIASES[stateName.toLowerCase()];
  return alias ? (CITIES_BY_STATE[alias] ?? []) : [];
}

/** Returns the state that uniquely contains this city, or null if ambiguous/unknown. */
export function lookupStateForCity(city: string): IndiaState | null {
  if (!city) return null;
  const stateName = _cityToState.get(city.toLowerCase());
  if (!stateName) return null;
  return INDIA_STATES.find(s => s.name === stateName) ?? null;
}

/** Normalise a state name from a CSV row: handles aliases, trailing spaces, etc. */
export function normalizeStateName(raw: string): { name: string; code: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { name: "", code: "" };
  const lower = trimmed.toLowerCase();
  // Try alias first
  const aliased = STATE_ALIASES[lower];
  const targetName = aliased ?? trimmed;
  const found = INDIA_STATES.find(s => s.name.toLowerCase() === targetName.toLowerCase());
  if (found) return { name: found.name, code: found.code };
  // Partial prefix match as last resort
  const partial = INDIA_STATES.find(s => s.name.toLowerCase().startsWith(lower));
  if (partial) return { name: partial.name, code: partial.code };
  return { name: trimmed, code: "" };
}
