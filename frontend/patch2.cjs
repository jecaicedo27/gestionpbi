const fs = require('fs');
let code = fs.readFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', 'utf8');

// 1. Add states
const stateTarget = "    const [inputMap, setInputMap] = useState({});";
const stateRepl = `    const [inputMap, setInputMap] = useState({});
    const [pickedSummary, setPickedSummary] = useState({});
    const [scannerText, setScannerText] = useState('');
    const [lastScan, setLastScan] = useState(null);
    const scannerInputRef = useRef(null);`;

code = code.replace(stateTarget, stateRepl);

fs.writeFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', code);
