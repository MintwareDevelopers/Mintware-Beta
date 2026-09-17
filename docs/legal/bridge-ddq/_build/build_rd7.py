from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='DocTitle', fontSize=18, leading=22, spaceAfter=6, fontName='Helvetica-Bold'))
styles.add(ParagraphStyle(name='DocSubtitle', fontSize=10, leading=14, textColor=colors.HexColor('#555555'), spaceAfter=14))
styles.add(ParagraphStyle(name='SectionHeading', fontSize=13, leading=16, spaceBefore=16, spaceAfter=8, fontName='Helvetica-Bold'))
styles.add(ParagraphStyle(name='Body', fontSize=10, leading=15, spaceAfter=10))

OUT = "/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/docs/legal/bridge-ddq"

def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#888888'))
    canvas.drawString(0.75*inch, 0.5*inch, "Mintware — Bridge/Stripe Due Diligence Questionnaire")
    canvas.drawRightString(letter[0]-0.75*inch, 0.5*inch, f"Page {doc.page}")
    canvas.restoreState()

story = [
    Paragraph("RD-7 — Funding Plans (Run on the Asset / Run on the Business)", styles['DocTitle']),
    Paragraph("Mintware · Bridge/Stripe Stablecoin-Issuing Card Program", styles['DocSubtitle']),
    HRFlowable(width="100%", thickness=1, color=colors.HexColor('#DDDDDD'), spaceAfter=12),
]

sections = [
    ("Run on the asset (rapid value decline)",
     "Mintware's program is USDC-denominated — the single most liquid, centrally-issued dollar "
     "stablecoin, not an exotic or volatile asset pair. Where ETH/LST collateral is involved "
     "elsewhere in the platform, it is discounted by a fixed VaR-style haircut before being counted "
     "as spendable, so a price move doesn't translate 1:1 into spending power. The structural "
     "protection is the senior/junior tranche ordering, which is code-enforced, not discretionary: "
     "community-facing capital is the senior, par-protected, spendable claim; the team's own capital "
     "is the junior, first-loss tranche, contractually required to absorb any shortfall before senior "
     "capital is ever touched. Senior redemption draws from a fixed-order waterfall — free senior "
     "buffer, then a yield adapter, then a bounded partial recovery from the deployed liquidity "
     "position, with the junior tranche as the last-resort backstop. This ordering cannot be altered "
     "by any admin call."),
    ("Run on the business (correlated withdrawal/spend demand)",
     "Two independent, code-enforced circuit breakers exist for this scenario. A system-wide circuit "
     "breaker can halt all new authorizations platform-wide regardless of any individual member's "
     "balance or cap — a deliberate stop-loss if a stress condition is detected. An always-liquid "
     "hot-buffer reserve floor is enforced before any charge is allowed to draw usable liquidity "
     "below it, sized to absorb settlement-timing risk. Both mechanisms fail toward halting activity "
     "rather than continuing to approve against a system that may not be able to honor its "
     "obligations."),
    ("Access to external capital",
     "Mintware does not currently hold a committed external credit facility, backstop line, or "
     "third-party capital-injection arrangement for stressed scenarios. The protection model is "
     "architectural: first-loss absorption by the team's own junior tranche, plus the circuit breaker "
     "and reserve floor described above, halt the system before it can be pushed into insolvency "
     "rather than relying on external recapitalization after the fact."),
]
for heading, body in sections:
    story.append(Paragraph(heading, styles['SectionHeading']))
    story.append(Paragraph(body, styles['Body']))

doc = SimpleDocTemplate(f"{OUT}/RD-7-Funding-Plans.pdf", pagesize=letter,
                         leftMargin=0.75*inch, rightMargin=0.75*inch, topMargin=0.75*inch, bottomMargin=0.75*inch)
doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print("Built RD-7-Funding-Plans.pdf")
