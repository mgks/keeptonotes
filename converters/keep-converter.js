// converters/keep-converter.js
class KeepConverter {
  // Logic to READ Google Keep files
  async parse(files, zip) {
  const notes = [];
  for (const file of files) {
    const note = await this.parseHtmlFile(file, zip);
    if (note) {
      notes.push(note);
    }
  }
  return notes;
}

  async parseHtmlFile(file, zip) {
    try {
      const text = await this.readFileAsText(file);
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');

      // Make parsing more robust. A note might not have a title or content.
      const title = doc.querySelector('title')?.textContent.replace(/[\\/:"*?<>|]/g, '-') || 'Untitled Note';
      const contentDiv = doc.querySelector('.content');
      let content = contentDiv ? contentDiv.innerHTML : '';
      
      // Check if it's a valid Keep note, otherwise skip it.
      if (!doc.body || (!title && !contentDiv)) {
          console.warn(`[SKIP] Skipping file '${file.name}' as it does not appear to be a valid Keep note.`);
          return null;
      }
      
      const dateDiv = doc.body?.children?.[1];
      const dateText = dateDiv ? dateDiv.textContent.trim() : '';
      const dt = this.parseDate(dateText);

      const tags = Array.from(doc.querySelectorAll('.label-name')).map(el => el.textContent);
      if (text.includes('"archived"')) {
        tags.push('archived');
      }

      // Attachment handling logic (placeholder for now, but shows the structure)
      const attachments = []; 
      // In a full implementation, you would parse the .attachments div, find image
      // references, and use the `zip` object to read their data.
      // For now, this structure prevents the parser from failing.

      console.log(`[PARSE] Successfully parsed note: '${title}'`);
      return {
        title,
        content,
        created: dt.toISOString(),
        updated: dt.toISOString(),
        tags,
        attachments,
      };
    } catch (e) {
      console.error(`[ERROR] Failed to parse Keep file '${file.name}':`, e);
      return null; // Return null to indicate failure for this file
    }
  }

  // Logic to WRITE Google Keep files (placeholder)
  async generate(notes) {
    console.log("Generating Keep files...", notes);
    alert("Exporting to Google Keep format is not yet implemented.");
    return null; // Should return a Blob for a ZIP file
  }
  
  parseDate(dateText) {
      const cleanedDateText = dateText.replace(/(\d{4}),/, '$1');
      let dt = dayjs(cleanedDateText);
      if (!dt.isValid()) dt = dayjs(new Date(dateText));
      if (!dt.isValid()) dt = dayjs();
      return dt;
  }

  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(event.target.result);
      reader.onerror = error => reject(error);
      reader.readAsText(file);
    });
  }
}