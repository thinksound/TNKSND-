// JXA: render an HTML file to a paginated PDF using AppKit's native text engine.
// Usage: osascript -l JavaScript html2pdf.jxa.js <input.html> <output.pdf>
ObjC.import('AppKit');

function run(argv) {
  const inPath  = argv[0];
  const outPath = argv[1];

  // US Letter, 0.6" margins (points: 72 = 1 inch)
  const pageW = 612, pageH = 792, margin = 43;
  const contentW = pageW - margin * 2;

  // Load HTML as NSData
  const url  = $.NSURL.fileURLWithPath(inPath);
  const data = $.NSData.dataWithContentsOfURL(url);

  // Import HTML -> NSAttributedString
  const opts = $.NSMutableDictionary.dictionary;
  opts.setObjectForKey($.NSHTMLTextDocumentType, $.NSDocumentTypeDocumentAttribute);
  opts.setObjectForKey($.NSNumber.numberWithInt(4), $.NSCharacterEncodingDocumentAttribute); // UTF-8
  const errPtr = Ref();
  const attr = $.NSAttributedString.alloc
    .initWithDataOptionsDocumentAttributesError(data, opts, $(), errPtr);
  if (!attr) { console.log('ERROR: failed to parse HTML'); return; }

  // Lay out in a text view sized to the content width
  const tv = $.NSTextView.alloc.initWithFrame(
    $.NSMakeRect(0, 0, contentW, contentH_guess()));
  tv.textStorage.setAttributedString(attr);
  tv.setVerticallyResizable(true);
  tv.setHorizontallyResizable(false);
  tv.textContainer.setContainerSize($.NSMakeSize(contentW, 1e7));
  tv.textContainer.setWidthTracksTextView(true);
  // Force layout, then size to fit content height
  tv.layoutManager.glyphRangeForTextContainer(tv.textContainer);
  const used = tv.layoutManager.usedRectForTextContainer(tv.textContainer);
  tv.setFrame($.NSMakeRect(0, 0, contentW, used.size.height + 4));

  function contentH_guess() { return 800; }

  // Print info -> paginate to PDF
  const pi = $.NSPrintInfo.alloc.initWithDictionary($.NSDictionary.dictionary);
  pi.setPaperSize($.NSMakeSize(pageW, pageH));
  pi.setTopMargin(margin);   pi.setBottomMargin(margin);
  pi.setLeftMargin(margin);  pi.setRightMargin(margin);
  pi.setHorizontalPagination($.NSPrintingPaginationModeFit);
  pi.setVerticalPagination($.NSPrintingPaginationModeAutomatic);

  // Save-as-PDF job disposition -> the print operation paginates the tall
  // text view into multiple Letter pages automatically.
  const outURL = $.NSURL.fileURLWithPath(outPath);
  const d = pi.dictionary;
  d.setObjectForKey($.NSPrintSaveJob, $.NSPrintJobDisposition);
  d.setObjectForKey(outURL, $.NSPrintJobSavingURL);

  const op = $.NSPrintOperation.printOperationWithViewPrintInfo(tv, pi);
  op.setShowsPrintPanel(false);
  op.setShowsProgressPanel(false);
  op.runOperation;

  console.log('wrote ' + outPath);
}
