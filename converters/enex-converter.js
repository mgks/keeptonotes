// converters/enex-converter.js
class EnexConverter {
  // Implemented the logic to parse .enex files.
  async parse(files) {
    const notes = [];
    for (const file of files) {
      try {
        const fileContent = await this.readFileAsText(file);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(fileContent, "application/xml");
        
        const noteNodes = xmlDoc.getElementsByTagName('note');
        for (const noteNode of noteNodes) {
          const title = noteNode.getElementsByTagName('title')[0]?.textContent || 'Untitled Note';
          const contentHTML = noteNode.getElementsByTagName('content')[0]?.textContent || '';
          
          // --- START OF DATE PARSING FIX ---
          // Safely get date strings, providing a fallback for missing tags.
          const createdStr = noteNode.getElementsByTagName('created')[0]?.textContent;
          const updatedStr = noteNode.getElementsByTagName('updated')[0]?.textContent;

          // Use dayjs to parse, but only if the string is valid. Otherwise, use the current time.
          const created = createdStr && dayjs(createdStr).isValid() ? dayjs(createdStr).toISOString() : new Date().toISOString();
          const updated = updatedStr && dayjs(updatedStr).isValid() ? dayjs(updatedStr).toISOString() : created;
          // --- END OF DATE PARSING FIX ---
          
          const tagNodes = noteNode.getElementsByTagName('tag');
          const tags = Array.from(tagNodes).map(tag => tag.textContent);

          // The content inside .enex is wrapped in its own XML structure.
          // A simple regex can often extract the inner HTML body for re-use.
          const contentMatch = /<en-note[^>]*>([\s\S]*)<\/en-note>/.exec(contentHTML);
          const content = contentMatch ? contentMatch[1] : '';

          notes.push({
            title,
            content,
            created,
            updated,
            tags,
            attachments: [], // Note: Parsing embedded attachments is a more complex task not included here.
          });
          console.log(`[PARSE] Successfully parsed ENEX note: '${title}'`);
        }
      } catch (e) {
        console.error(`[ERROR] Failed to parse ENEX file '${file.name}':`, e);
      }
    }
    return notes;
  }

  // Logic to WRITE .enex files
  async generate(notes) {
    const currentDate = dayjs().format('YYYYMMDDTHHmmssZ');
    let enexContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">
<en-export export-date="${currentDate}" application="NotesMigrator" version="1.0">`;

    for (const note of notes) {
      enexContent += this.createNoteXml(note);
    }

    enexContent += '</en-export>';
    return enexContent;
  }

  createNoteXml(note) {
    const created = dayjs(note.created).format('YYYYMMDDTHHmmssZ');
    const updated = dayjs(note.updated).format('YYYYMMDDTHHmmssZ');
    const tagsXml = note.tags.map(tag => `<tag>${this.escapeXml(tag)}</tag>`).join('');
    const content = this.formatContentForEnex(note.content);
    
    return `
  <note>
    <title>${this.escapeXml(note.title)}</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note>${content}</en-note>]]></content>
    <created>${created}</created>
    <updated>${updated}</updated>
    ${tagsXml}
  </note>`;
  }
  
  formatContentForEnex(htmlContent) {
    return `<div>${htmlContent.replace(/<br>/g, '<br/>')}</div>`;
  }

  escapeXml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[<>&'"]/g, c => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
    });
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