from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, HRFlowable, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='DocTitle', fontSize=18, leading=22, spaceAfter=6, fontName='Helvetica-Bold'))
styles.add(ParagraphStyle(name='DocSubtitle', fontSize=10, leading=14, textColor=colors.HexColor('#555555'), spaceAfter=14))
styles.add(ParagraphStyle(name='SectionHeading', fontSize=13, leading=16, spaceBefore=16, spaceAfter=8, fontName='Helvetica-Bold'))
styles.add(ParagraphStyle(name='Body', fontSize=10, leading=15, spaceAfter=10))

HERE = "/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/docs/legal/bridge-ddq/_build"
OUT = "/Users/nicolasrobinson/Downloads/Mintware Phase 1 app Build/docs/legal/bridge-ddq"

def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#888888'))
    canvas.drawString(0.75*inch, 0.5*inch, "Mintware — Bridge/Stripe Due Diligence Questionnaire")
    canvas.drawRightString(letter[0]-0.75*inch, 0.5*inch, f"Page {doc.page}")
    canvas.restoreState()

def build(filename, title, subtitle, sections, diagram=None):
    story = [Paragraph(title, styles['DocTitle']), Paragraph(subtitle, styles['DocSubtitle']),
             HRFlowable(width="100%", thickness=1, color=colors.HexColor('#DDDDDD'), spaceAfter=12)]
    if diagram:
        story.append(Paragraph("Diagram", styles['SectionHeading']))
        # Available height on page 1 below the heading, so the whole image fits on ONE page:
        # page height 11in - 0.75*2 margins - (title+subtitle+rule+heading ~2.1in) = ~7.4in.
        img = Image(diagram)
        img._restrictSize(4.2*inch, 7.3*inch)
        story.append(img)
        story.append(PageBreak())  # narrative starts clean on its own page, never glued under the diagram
    for heading, body in sections:
        if heading:
            story.append(Paragraph(heading, styles['SectionHeading']))
        story.append(Paragraph(body, styles['Body']))
    doc = SimpleDocTemplate(f"{OUT}/{filename}", pagesize=letter,
                             leftMargin=0.75*inch, rightMargin=0.75*inch, topMargin=0.75*inch, bottomMargin=0.75*inch)
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"Built {filename}")

# ---------------- RD-1 ----------------
build(
    "RD-1-Funds-Flow-Document.pdf",
    "RD-1 — Funds Flow Document",
    "Mintware · Bridge/Stripe Stablecoin-Issuing Card Program",
    [
        ("Narrative Walkthrough", ""),
        ("1. Funding wallet.", "Each card is funded from the member's own Privy embedded wallet — one "
         "wallet, one card. The member holds the wallet; Mintware never holds a private key that can "
         "move 100% of a member's balance unilaterally."),
        ("2. The allowance, not a balance transfer.", "The funding wallet grants a capped ERC-20 "
         "approve(spender, allowance) on USDC to a per-program Bridge-provisioned spender address — a "
         "capped standing pull-right, sized to daily cap × coverage days, hard-ceilinged at $50,000, "
         "further scoped to a multiple of the intended buffer target when configured. Bridge can never "
         "pull more than this capped amount, regardless of what else sits in the wallet."),
        ("3. At swipe time,", "Bridge/Stripe pull the exact authorized amount via that allowance — "
         "reading the wallet's real on-chain USDC balance, never a vault NAV computation."),
        ("4. The authorization decision", "runs belt-and-suspenders: a role-based daily spend cap "
         "checked against the member's actual approved spend for the day, plus an optional standing "
         "tier that can only ever widen a limit within the existing hard cap. Suspenders are a flat "
         "pre-funded buffer check or a live NAV-based hold via edge-auth, which fails closed if "
         "unconfigured."),
        ("5. Where the money sits.", "The USDC the buffer draws from originates in the Mintware "
         "Treasury Vault — a senior/junior tranche structure. Community-facing senior capital is the "
         "par-protected, spendable claim; the team's own junior capital is contractually first-loss and "
         "is drawn down before senior capital in any shortfall — code-enforced, not discretionary."),
        ("6. Settlement", "is executed by a designated oracle signer holding a specific on-chain role, "
         "not an arbitrary hot wallet."),
        ("Custody Characterization", "Mintware's card program is non-custodial. The card funding wallet "
         "is the member's own Privy-embedded wallet — self-custodied, with no single Mintware-controlled "
         "key capable of moving it unilaterally. The underlying treasury position is likewise not held "
         "in a Mintware-controlled bank account: it is a smart-contract-governed pool, with depositor "
         "claims enforced by contract logic rather than by Mintware custody. Mintware at no point holds "
         "a private key or account that can unilaterally move user funds."),
    ],
    diagram=f"{HERE}/flow.png",
)

# ---------------- RD-8 ----------------
build(
    "RD-8-Fraud-Prevention-Program.pdf",
    "RD-8 — Fraud Prevention Program",
    "Mintware · Bridge/Stripe Stablecoin-Issuing Card Program",
    [
        ("1. Spend authorization — belt and suspenders",
         "Every card swipe passes through two independent controls. <b>Belt — role-based daily cap:</b> "
         "each member's spend is bounded by a fixed role-preset daily limit, checked against cumulative "
         "approved spend for the current UTC day, not just the single swipe in question. An optional "
         "standing tier can widen this limit for members with a track record of settled spend, but can "
         "only ever widen a limit within the existing hard cap. <b>Suspenders — real-money backstop, "
         "fail-closed:</b> every swipe is independently checked against either a pre-funded, "
         "atomically-reserved buffer balance, or a live hold against the member's actual on-chain vault "
         "equity. If the live-hold service is unreachable or unconfigured, the swipe is declined."),
        ("2. System-wide circuit breaker",
         "A global guard can halt all authorizations platform-wide — every charge, even a trivially "
         "fundable one, declines with a distinct reason, regardless of any individual balance or cap. A "
         "deliberate stop-loss: if a stress condition is detected upstream, the whole authorization "
         "surface halts rather than continuing to approve against a system that may not be able to "
         "honor them."),
        ("3. Always-liquid hot-buffer reserve",
         "A configurable minimum-liquidity-reserve floor is enforced before any charge is allowed to "
         "draw liquidity below it — sized to absorb settlement-timing risk. A charge that would breach "
         "this floor is declined with its own distinct reason, separate from a plain insufficient-funds "
         "decline."),
        ("4. Multi-collateral, freshness-gated valuation",
         "Where a member's spend authority spans more than one collateral type, the aggregate spendable "
         "amount is the sum of each position's equity, with a hard safety rule: a single stale price or "
         "stale NAV on any one leg fails the entire aggregate valuation safe. ETH-denominated legs are "
         "additionally reduced by a VaR-style haircut before being counted as spendable."),
        ("5. Idempotent, capped settlement",
         "The on-chain settlement leg is capped under $250 per transaction on the current settlement "
         "path, bounding maximum single-transaction exposure regardless of any other control. Settlement "
         "is idempotent per hold: a repeated settlement request for the same authorized hold cannot "
         "double-submit or double-pay."),
        ("6. Fail-closed posture as a design principle",
         "Every money-moving control in this program defaults to declining, not approving, when a "
         "dependency is unavailable — an unreachable authorization service, or an unset bearer secret on "
         "an internal service, both result in rejection, never a default approval."),
        ("7. Scope",
         "Device/behavioral fraud signals (velocity checks beyond the daily cap, geolocation anomaly "
         "detection, merchant-category risk scoring) run on Stripe Issuing's own network-level fraud "
         "tooling (Radar), composing with the controls above rather than duplicating them."),
    ],
)
