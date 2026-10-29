// Seance auditor token: a stealth token whose every output carries an ElGamal proof that the holder of ONE view key (the auditor)
// can open to read the amount. It cannot spend, and it cannot read the memo (the memo is encrypted to the recipient's own view key).
// Our own code (MIT), written for a Halloween testnet demo from the public tari_template_lib API. Esmeralda testnet only.
use tari_template_lib::prelude::*;

#[template]
mod seance_auditor_token {
    use super::*;

    pub struct SeanceAuditorToken {
        resource: ResourceAddress,
    }

    impl SeanceAuditorToken {
        /// Makes the token. `auditor` is the public half of the auditor's view key; the secret half stays with the auditor.
        pub fn new(auditor: RistrettoPublicKeyBytes) -> Component<Self> {
            let resource = ResourceBuilder::stealth()
                .with_token_symbol("SEANCE")
                .with_view_key(auditor)
                .mintable(rule!(allow_all), LOCKED) // shortcut: anyone may mint, which is fine for a testnet toy; use an owner rule for anything real
                .build();
            Component::new(Self { resource }).with_access_rules(ComponentAccessRules::allow_all()).create()
        }

        /// Mints `amount` as a public (revealed) balance. A stealth transfer then turns it into sealed outputs.
        pub fn mint(&self, amount: Amount) -> Bucket {
            ResourceManager::get(self.resource).mint_stealth(amount)
        }

        pub fn resource(&self) -> ResourceAddress {
            self.resource
        }
    }
}
