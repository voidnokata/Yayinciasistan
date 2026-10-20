(() => {
  const USERNAME_PATTERN = /^[A-Za-z0-9._]{2,32}$/;
  const USERNAME_COLUMN_HEADERS = new Set([
    "username",
    "user name",
    "kullaniciadi",
    "kullanici adi",
    "kullanıcıadı",
    "kullanıcı adı",
    "tiktok username",
    "tiktok kullanici adi",
    "tiktok kullanıcı adı"
  ]);
  const HEADER_WORDS = new Set([
    ...USERNAME_COLUMN_HEADERS,
    "tiktok",
    "yayinci",
    "yayıncı",
    "yayinci adi",
    "yayıncı adı"
  ]);

  async function readUsernamesFromFile(file) {
    if (!(file instanceof File)) throw new Error("Dosya seçilemedi.");
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    let rows;

    if (extension === "xlsx") {
      rows = await readXlsxRows(await file.arrayBuffer());
    } else if (["csv", "txt", "tsv"].includes(extension)) {
      rows = parseDelimitedRows(await file.text());
    } else if (extension === "xls") {
      throw new Error("Eski .xls biçimi desteklenmiyor. Dosyayı Excel'de .xlsx veya .csv olarak kaydedin.");
    } else {
      throw new Error("Desteklenen dosya biçimleri: .xlsx, .csv ve .txt");
    }

    const usernames = extractUsernames(rows);
    if (!usernames.length) {
      throw new Error(
        "Dosyada geçerli TikTok kullanıcı adı bulunamadı. Excel çıktısında “Kullanıcı Adı” sütununun bulunduğundan emin olun."
      );
    }
    return usernames;
  }

  function parseDelimitedRows(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    function pushCell() {
      row.push(cell.trim());
      cell = "";
    }

    function pushRow() {
      pushCell();
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
    }

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (!quoted && [",", ";", "\t"].includes(char)) {
        pushCell();
      } else if (!quoted && ["\n", "\r"].includes(char)) {
        pushRow();
        if (char === "\r" && text[index + 1] === "\n") index += 1;
      } else {
        cell += char;
      }
    }

    if (cell.length || row.length) pushRow();
    return rows;
  }

  function extractUsernames(rawValues) {
    const rows = normalizeRows(rawValues);
    const output = [];
    const seen = new Set();
    const usernameColumn = findUsernameColumn(rows);

    if (usernameColumn) {
      for (let rowIndex = usernameColumn.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
        addCandidates(rows[rowIndex]?.[usernameColumn.columnIndex]);
      }
      return output;
    }

    for (const row of rows) {
      for (const value of row) addCandidates(value);
    }
    return output;

    function addCandidates(rawValue) {
      const value = String(rawValue ?? "").trim();
      if (!value) return;

      const directMatches = [];
      for (const match of value.matchAll(/(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{2,32})/gi)) {
        directMatches.push(match[1]);
      }
      for (const match of value.matchAll(/(?:^|[^A-Za-z0-9._])@([A-Za-z0-9._]{2,32})(?=$|[^A-Za-z0-9._])/g)) {
        directMatches.push(match[1]);
      }

      if (directMatches.length) {
        for (const username of directMatches) addUsername(username);
        return;
      }

      for (const piece of value.split(/[\r\n,;\t]+/)) {
        const cleaned = piece
          .trim()
          .replace(/^['"]|['"]$/g, "")
          .replace(/^@/, "")
          .replace(/^https?:\/\/(?:www\.)?tiktok\.com\/@/i, "")
          .replace(/[/?#].*$/, "")
          .trim();
        if (isUsernameHeader(cleaned)) continue;
        if (USERNAME_PATTERN.test(cleaned)) addUsername(cleaned);
      }
    }

    function addUsername(rawUsername) {
      const username = String(rawUsername || "").replace(/^@/, "").trim();
      if (!USERNAME_PATTERN.test(username)) return;
      const key = username.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      output.push(username);
    }
  }

  function normalizeRows(rawValues) {
    if (!Array.isArray(rawValues)) return [];
    if (rawValues.some(Array.isArray)) {
      return rawValues.map((row) => (Array.isArray(row) ? row : [row]));
    }
    return rawValues.map((value) => [value]);
  }

  function findUsernameColumn(rows) {
    const scanLimit = Math.min(rows.length, 25);
    for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        if (isUsernameColumnHeader(row[columnIndex])) return { rowIndex, columnIndex };
      }
    }
    return null;
  }

  function isUsernameColumnHeader(value) {
    const normalized = normalizeHeader(value);
    return (
      USERNAME_COLUMN_HEADERS.has(normalized) ||
      USERNAME_COLUMN_HEADERS.has(normalized.replace(/\s/g, ""))
    );
  }

  function isUsernameHeader(value) {
    const normalized = normalizeHeader(value);
    return HEADER_WORDS.has(normalized) || HEADER_WORDS.has(normalized.replace(/\s/g, ""));
  }

  function normalizeHeader(value) {
    return String(value ?? "")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/[\s_-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  async function readXlsxRows(arrayBuffer, allSheets = false, options = {}) {
    const archive = new ZipArchive(arrayBuffer);
    const workbookXml = await archive.readText("xl/workbook.xml");
    const relsXml = await archive.readText("xl/_rels/workbook.xml.rels");
    const workbook = parseXml(workbookXml, "Excel çalışma kitabı okunamadı.");
    const relationships = parseXml(relsXml, "Excel çalışma kitabı ilişkileri okunamadı.");

    const sheets = elementsByLocalName(workbook, "sheet");
    if(options.strictFeedback && sheets.length !== 1) throw new Error("Geri bildirim Excel dosyası tek çalışma sayfası içermeli.");
    if (!sheets.length) throw new Error("Excel dosyasında çalışma sayfası bulunamadı.");
    const rows = [];
    for (const firstSheet of (allSheets ? sheets : sheets.slice(0,1))) {
    const relationshipId =
      firstSheet.getAttribute("r:id") ||
      firstSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const relationship = elementsByLocalName(relationships, "Relationship")
      .find((item) => item.getAttribute("Id") === relationshipId);
    let sheetPath = relationship?.getAttribute("Target") || "worksheets/sheet1.xml";
    sheetPath = resolveZipPath("xl/workbook.xml", sheetPath);

    let sharedStrings = [];
    if (archive.has("xl/sharedStrings.xml")) {
      const sharedXml = parseXml(
        await archive.readText("xl/sharedStrings.xml"),
        "Excel ortak metin tablosu okunamadı."
      );
      sharedStrings = elementsByLocalName(sharedXml, "si").map((item) =>
        elementsByLocalName(item, "t").map((text) => text.textContent || "").join("")
      );
    }

    const sheetXml = parseXml(await archive.readText(sheetPath), "Excel çalışma sayfası okunamadı.");
    for (const rowNode of elementsByLocalName(sheetXml, "row")) {
      const row = [];
      let fallbackColumnIndex = 0;
      for (const cell of elementsByLocalName(rowNode, "c")) {
        if(options.strictFeedback && elementsByLocalName(cell, "f").length) throw new Error("Geri bildirim Excel dosyasında formül kullanılamaz.");
        const reference = cell.getAttribute("r") || "";
        const columnIndex = reference ? columnIndexFromReference(reference) : fallbackColumnIndex;
        row[columnIndex] = readCellValue(cell, sharedStrings);
        fallbackColumnIndex = columnIndex + 1;
      }
      if (row.some((value) => String(value ?? "").trim())) rows.push(row);
    }
    }
    return rows;
  }

  function readCellValue(cell, sharedStrings) {
    const type = cell.getAttribute("t") || "";
    if (type === "inlineStr") {
      return elementsByLocalName(cell, "t").map((item) => item.textContent || "").join("");
    }
    const valueNode = elementsByLocalName(cell, "v")[0];
    const raw = valueNode?.textContent ?? "";
    if (type === "s") return sharedStrings[Number(raw)] ?? "";
    if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
    return raw;
  }

  function columnIndexFromReference(reference) {
    const letters = String(reference).match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || "A";
    let result = 0;
    for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
    return Math.max(0, result - 1);
  }

  class ZipArchive {
    constructor(arrayBuffer) {
      this.bytes = new Uint8Array(arrayBuffer);
      this.view = new DataView(arrayBuffer);
      this.entries = this.readEntries();
    }

    has(name) {
      return this.entries.has(normalizeZipPath(name));
    }

    async readText(name) {
      return new TextDecoder("utf-8").decode(await this.read(name));
    }

    async read(name) {
      const normalizedName = normalizeZipPath(name);
      const entry = this.entries.get(normalizedName);
      if (!entry) throw new Error(`Excel dosyasının gerekli bölümü bulunamadı: ${normalizedName}`);
      const offset = entry.localHeaderOffset;
      if (this.view.getUint32(offset, true) !== 0x04034b50) {
        throw new Error("Excel ZIP yerel başlığı geçersiz.");
      }
      const nameLength = this.view.getUint16(offset + 26, true);
      const extraLength = this.view.getUint16(offset + 28, true);
      const start = offset + 30 + nameLength + extraLength;
      const compressed = this.bytes.slice(start, start + entry.compressedSize);

      if (entry.method === 0) return compressed;
      if (entry.method !== 8) {
        throw new Error(`Excel ZIP sıkıştırma yöntemi desteklenmiyor: ${entry.method}`);
      }
      if (typeof DecompressionStream !== "function") {
        throw new Error("Bu Chrome sürümü .xlsx açmak için gerekli sıkıştırma desteğini sunmuyor.");
      }
      const stream = new Blob([compressed])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    readEntries() {
      const endOffset = this.findEndOfCentralDirectory();
      const entryCount = this.view.getUint16(endOffset + 10, true);
      const centralDirectoryOffset = this.view.getUint32(endOffset + 16, true);
      const entries = new Map();
      let offset = centralDirectoryOffset;

      for (let index = 0; index < entryCount; index += 1) {
        if (this.view.getUint32(offset, true) !== 0x02014b50) {
          throw new Error("Excel ZIP merkez dizini geçersiz.");
        }
        const method = this.view.getUint16(offset + 10, true);
        const compressedSize = this.view.getUint32(offset + 20, true);
        const nameLength = this.view.getUint16(offset + 28, true);
        const extraLength = this.view.getUint16(offset + 30, true);
        const commentLength = this.view.getUint16(offset + 32, true);
        const localHeaderOffset = this.view.getUint32(offset + 42, true);
        const nameBytes = this.bytes.slice(offset + 46, offset + 46 + nameLength);
        const name = normalizeZipPath(new TextDecoder("utf-8").decode(nameBytes));
        entries.set(name, { method, compressedSize, localHeaderOffset });
        offset += 46 + nameLength + extraLength + commentLength;
      }
      return entries;
    }

    findEndOfCentralDirectory() {
      const minimum = Math.max(0, this.bytes.length - 65557);
      for (let offset = this.bytes.length - 22; offset >= minimum; offset -= 1) {
        if (this.view.getUint32(offset, true) === 0x06054b50) return offset;
      }
      throw new Error("Dosya geçerli bir .xlsx arşivi değil.");
    }
  }

  function parseXml(text, errorMessage) {
    const document = new DOMParser().parseFromString(text, "application/xml");
    if (document.getElementsByTagName("parsererror").length) throw new Error(errorMessage);
    return document;
  }

  function elementsByLocalName(root, localName) {
    return Array.from(root.getElementsByTagNameNS("*", localName));
  }

  function resolveZipPath(baseFile, target) {
    if (target.startsWith("/")) return normalizeZipPath(target.slice(1));
    const parts = normalizeZipPath(baseFile).split("/");
    parts.pop();
    for (const piece of normalizeZipPath(target).split("/")) {
      if (!piece || piece === ".") continue;
      if (piece === "..") parts.pop();
      else parts.push(piece);
    }
    return parts.join("/");
  }

  function normalizeZipPath(value) {
    return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  }

  window.BTGSpreadsheetReader = {
    readXlsxRows,
    readUsernamesFromFile,
    extractUsernames
  };
})();

