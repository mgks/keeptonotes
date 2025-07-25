// src/main.js

class NoteMigratorUI {
  constructor() {
    this.formats = {
      keep: {
        displayName: 'Google Keep',
        direction: 'both',
        disabledTo: true,
        fileTypes: '.zip,.html',
        module: new KeepConverter(),
        exportInstructions: `In <a href="https://takeout.google.com/" target="_blank">Google Takeout</a>, click "Deselect all," then select only <strong>Keep</strong>. Export as a .zip file.`,
        importInstructions: `Google Keep does not support importing notes. This option is for creating a backup in Keep's native format.`,
      },
      apple: {
        displayName: 'Apple Notes',
        direction: 'to',
        module: new EnexConverter(),
        importInstructions: `On a Mac, open the Notes app, go to <strong>File > Import to Notes...</strong> and select the downloaded <code>.enex</code> file. On iPhone/iPad, save the file to your device, open it via the Files app, tap the Share icon, and choose Notes.`,
      },
      enex: {
        displayName: 'Evernote (.enex)',
        direction: 'both',
        fileTypes: '.enex',
        module: new EnexConverter(),
        exportInstructions: `In the Evernote desktop app, right-click a notebook and choose "Export...". Ensure the format is set to <strong>ENEX (.enex)</strong>.`,
        importInstructions: `In the Evernote desktop app, go to <strong>File > Import...</strong> and select the generated <code>.enex</code> file.`,
      },
      markdown: {
        displayName: 'Markdown / Notion',
        direction: 'both',
        fileTypes: '.zip,.md',
        module: new MarkdownConverter(),
        exportInstructions: `From Notion, open a page and select "Export" from the top-right menu. Choose <strong>Markdown & CSV</strong> format. For best results, include subpages and create folders for them.`,
        importInstructions: `Notion can import the generated <code>.zip</code> file directly. Go to <strong>Settings & Members > Settings > Import data</strong> and choose "HTML".`,
      },
      onenote: {
        displayName: 'Microsoft OneNote',
        direction: 'both',
        disabled: true,
        exportInstructions: `OneNote does not support modern file exports. API-based migration is planned for a future version.`,
      },
    };

    this.fromSelect = document.getElementById('convertFrom');
    this.toSelect = document.getElementById('convertTo');
    this.dropZone = document.getElementById('dropZone');
    this.fileInput = document.getElementById('fileInput');
    this.fileList = document.getElementById('fileList');
    this.convertButton = document.getElementById('convertButton');
    this.instructions = document.getElementById('instructions');
    this.darkModeToggle = document.getElementById('darkModeToggle');
    
    this.files = [];
    this.zip = null;

    this.initCustomSelects();
    this.setupEventListeners();
    this.loadThemePreference();
    this.updateUIForSelection();
  }

  // --- Initialization ---
  initCustomSelects() {
    this.fromSelect.dataset.value = 'keep';
    this.toSelect.dataset.value = 'apple';

    this.populateSelect(this.fromSelect, 'from');
    this.populateSelect(this.toSelect, 'to');
  }

  populateSelect(selectElement, direction) {
    const dropdown = selectElement.querySelector('.select-dropdown');
    dropdown.innerHTML = '';
    
    for (const [key, format] of Object.entries(this.formats)) {
      if (format.direction === direction || format.direction === 'both') {
        const option = document.createElement('div');
        option.className = 'option';
        option.dataset.value = key;
        option.textContent = format.displayName;

        // More robust disabling logic
        let isDisabled = format.disabled || (direction === 'to' && format.disabledTo);
        if (isDisabled) {
          option.classList.add('disabled');
        }
        dropdown.appendChild(option);
      }
    }
  }

  // --- Event Listeners ---
  setupEventListeners() {
    document.querySelectorAll('.custom-select').forEach(select => {
      const button = select.querySelector('.select-button');
      const dropdown = select.querySelector('.select-dropdown');
      
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-select').forEach(other => {
            if (other !== select) other.classList.remove('open');
        });
        select.classList.toggle('open');
      });

      dropdown.addEventListener('click', (e) => {
        if (e.target.classList.contains('option') && !e.target.classList.contains('disabled')) {
          const oldValue = select.dataset.value;
          const newValue = e.target.dataset.value;
          
          if (oldValue !== newValue) {
            select.dataset.value = newValue;
            button.querySelector('span').textContent = e.target.textContent;
            this.updateUIForSelection();
            
            // GA Event for format selection
            if (typeof gtag === 'function') {
              gtag('event', 'select_format', {
                'event_category': 'conversion_setup',
                'event_label': `${select.id === 'convertFrom' ? 'from' : 'to'}_${newValue}`
              });
            }
          }
          select.classList.remove('open');
        }
      });
    });

    document.addEventListener('click', () => {
      document.querySelectorAll('.custom-select').forEach(s => s.classList.remove('open'));
    });
    
    this.darkModeToggle.addEventListener('click', () => {
      const isDarkMode = document.body.classList.toggle('dark-mode');
      this.saveThemePreference(isDarkMode);
      
      // GA Event for theme toggle
      if (typeof gtag === 'function') {
        gtag('event', 'toggle_theme', {
          'event_category': 'ui_interaction',
          'event_label': isDarkMode ? 'dark' : 'light'
        });
      }
    });

    this.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); this.dropZone.classList.add('active'); });
    this.dropZone.addEventListener('dragleave', () => { this.dropZone.classList.remove('active'); });
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('active');
      this.handleFiles(e.dataTransfer.files, 'drop'); // Pass method
    });
    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files, 'browse')); // Pass method
    this.convertButton.addEventListener('click', () => this.runConversion());
  }

  // --- UI and State Management ---
  updateUIForSelection() {
    const fromKey = this.fromSelect.dataset.value;
    const toKey = this.toSelect.dataset.value;

    // Reset file-specific state whenever the selection changes
    this.resetState();

    if (fromKey === toKey) {
      this.convertButton.disabled = true;
      this.instructions.innerHTML = `<p class="warning">Cannot convert a format to itself. Please select a different "To" format.</p>`;
      return;
    }

    const fromFormat = this.formats[fromKey];
    const toFormat = this.formats[toKey];
    
    this.fileInput.accept = fromFormat.fileTypes || '';
    this.instructions.innerHTML = `<p><strong>Export from ${fromFormat.displayName}:</strong> ${fromFormat.exportInstructions}</p>
                                   <p><strong>Import to ${toFormat.displayName}:</strong> ${toFormat.importInstructions}</p>`;
  }

  async handleFiles(fileList, method) {
    this.files = Array.from(fileList);
    if (this.files.length === 0) return;

    // ... (GA event tracking remains the same)
    if (typeof gtag === 'function') {
      gtag('event', 'upload_files', {
        'event_category': 'file_interaction',
        'event_label': method, // 'drop' or 'browse'
        'value': this.files.length
      });
    }

    document.getElementById('fileList').classList.remove('hidden');
    document.getElementById('selectedFilesTitle').classList.remove('hidden');
    this.fileList.innerHTML = this.files.map(f => `<li>${f.name}</li>`).join('');
    
    this.zip = null;
    const zipFile = this.files.find(f => f.name.endsWith('.zip'));
    if (zipFile) {
        try {
            this.zip = await JSZip.loadAsync(zipFile);
        } catch (e) {
            alert("Error: Could not read the ZIP file.");
            this.resetState(); // Call full reset
            this.updateUIForSelection(); // Re-evaluate UI state
            return;
        }
    }
    // Only enable the convert button if files are present AND formats are different
    this.convertButton.disabled = (this.fromSelect.dataset.value === this.toSelect.dataset.value);
  }

  async runConversion() {
    this.convertButton.disabled = true;
    const fromKey = this.fromSelect.dataset.value;
    const toKey = this.toSelect.dataset.value;
    const fromModule = this.formats[fromKey].module;
    const toModule = this.formats[toKey].module;

    // GA Event for starting a conversion
    if (typeof gtag === 'function') {
      gtag('event', 'start_conversion', {
        'event_category': 'conversion_process',
        'event_label': `${fromKey}_to_${toKey}`,
      });
    }

    try {
      const notes = await fromModule.parse(this.files, this.zip);
      if (!notes || notes.length === 0) {
        // GA Event for conversion failure (no notes found)
        if (typeof gtag === 'function') {
          gtag('event', 'error', {
            'event_category': 'conversion_process',
            'event_label': 'no_notes_found',
            'description': `${fromKey}_to_${toKey}`
          });
        }
        alert("No valid notes were found. Please check your file(s) and try again.");
        this.resetState();
        this.updateUIForSelection(); // Re-evaluate UI state
        return;
      }

      const output = await toModule.generate(notes);
      this.downloadOutput(output, toKey);
      
      // GA Event for successful conversion
      if (typeof gtag === 'function') {
        gtag('event', 'conversion_success', {
          'event_category': 'conversion_process',
          'event_label': `${fromKey}_to_${toKey}`,
          'value': notes.length // Number of notes converted
        });
      }

    } catch (error) {
      // GA Event for critical conversion error
      if (typeof gtag === 'function') {
        gtag('event', 'error', {
          'event_category': 'conversion_process',
          'event_label': 'conversion_failed',
          'description': `${fromKey}_to_${toKey}: ${error.message}`
        });
      }
      console.error("Conversion failed:", error);
      alert(`An error occurred: ${error.message}`);
    } finally {
      this.resetState();
      this.updateUIForSelection(); // Re-evaluate UI state
    }
  }

  downloadOutput(output, formatKey) {
    if (!output) return;
    
    const downloadDetails = {
        apple: { filename: 'notes-for-apple.enex', type: 'application/xml' },
        enex: { filename: 'notes.enex', type: 'application/xml' },
        markdown: { filename: 'notes_markdown.zip', type: 'application/zip' },
        keep: { filename: 'notes_keep.zip', type: 'application/zip' },
    };

    const details = downloadDetails[formatKey];
    const blob = output instanceof Blob ? output : new Blob([output], { type: details.type });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = details.filename;
    link.click();
  }

  resetState() {
    this.files = [];
    this.zip = null;
    this.fileInput.value = '';
    this.fileList.innerHTML = '';
    document.getElementById('fileList').classList.add('hidden');
    document.getElementById('selectedFilesTitle').classList.add('hidden');
    this.convertButton.disabled = true;
  }

  // --- Theme Preference ---
  loadThemePreference() {
    const darkModeSaved = localStorage.getItem('darkMode');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (darkModeSaved === 'true' || (darkModeSaved === null && systemPrefersDark)) {
      document.body.classList.add('dark-mode');
      // GA Event for initial theme
      if (typeof gtag === 'function') {
        gtag('event', 'initial_theme', {
          'event_category': 'ui_interaction',
          'event_label': darkModeSaved === null ? 'system_dark' : 'user_dark'
        });
      }
    }
  }

  saveThemePreference(isDarkMode) {
    localStorage.setItem('darkMode', isDarkMode);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  new NoteMigratorUI();
});