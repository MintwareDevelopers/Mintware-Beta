# Draft email — justifying document gaps to Bridge

**Subject: DDQ documents — a few we can attach now, and why a few genuinely don't exist on our end**

Hi Osman,

Progress update on the DDQ — attaching RD-1, RD-4, RD-5, RD-7, and RD-8 now (funds flow, BSA/AML
policy, sanctions policy, funding plans, fraud prevention). A few items need a direct answer instead
of a document, and I'd rather tell you why than send something that looks like a document but isn't
one:

**RD-3 (age/location verification controls assessment) and the underlying KYC/AML/sanctions
screening itself (AML-1 through AML-7, SC-1 through SC-9):** per your own confirmation, these run on
Bridge/Stripe's infrastructure, not ours — we don't operate an independent verification system to
assess. Worth noting this is the standard shape of this stack generally, not just our read of it:
Privy's own public documentation for card programs built on this exact Bridge/Stripe/Lead Bank rail
states plainly that "Bridge is the program manager for your cards" and that "onboarding, disclosures,
statements, and support are handled for you" — i.e., merchants on this stack aren't expected to
independently operate this layer. (https://docs.privy.io/financial-flows/cards/pre-built-components/overview)

**RD-2 (regulatory registrations/licenses):** we don't hold independent money-transmitter licenses —
our understanding, consistent with the program structure above, is that licensing coverage for this
program sits with Lead Bank and Bridge as the regulated parties, not with us as a program participant.
Please correct us directly if that understanding is wrong for our specific setup.

**RD-6 (independent Financial Crimes compliance assessment):** this requires an actual third-party
assessor. Our own policy documents (RD-4/RD-5) are now signed and finalized, so we're ready to pursue
this as the next step — happy to move on it once you confirm what kind of assessor/scope you'd want to
see.

Two open items we'd still like a direct answer on:

1. Is there a standard state-level geolocation restriction list you require of merchants in this
   program (similar to the sanctioned-countries list on SC-7), or is that something we need to
   determine independently with counsel?
2. For SOC 2 (IS-5) specifically — is that covered under "most of this," or does it need to sit on
   our side? If the latter, is there an accepted interim path for an early-stage team?

Happy to jump on a call if that's faster than back-and-forth on any of this.

Thanks,
Nic
