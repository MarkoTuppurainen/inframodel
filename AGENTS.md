# AGENTS.md

Ohjeet agenteille, jotka työskentelevät tässä repossa (`InfraModel Validator`).

## Projektin tarkoitus

- InfraModel Validator on selainpohjainen kevyt verkkosivu.
- Käyttäjä valitsee yhden tai useamman `.xml`-tiedoston.
- Sovellus tarkistaa paikallisesti selaimessa, onko tiedosto InfraModel-formaatin mukainen.
- Käyttäjän tiedostoja tai niiden sisältöä ei saa lähettää palvelimelle.
- Sivusto julkaistaan GitHub Pagesissa, joten ratkaisun tulee toimia staattisena sivustona.

## Arkkitehtuuri ja rajaukset

- Älä lisää palvelinpuolen ratkaisua.
- Älä lisää riippuvuutta, joka vaatii backendin, build-palvelimen tai GitHub Pagesille sopimattoman ajonaikaisen ympäristön.
- Säilytä nykyinen yksinkertainen arkkitehtuuri aina kun mahdollista.
- Tee muutokset mahdollisimman pieninä ja kohdennettuina.
- Kaiken XML-käsittelyn tulee tapahtua lokaalisti selaimessa.
- Tämä ei ole täydellinen XML Schema -validaattori, vaan osittain XSD-skeemoja hyödyntävä sääntöpohjainen validaattori.

## Ensisijaiset lähteet

Käytä ensisijaisena lähteenä InfraModel 4.2.0 GitHub releasea ja julkaistuja skeemoja:

- InfraModel 4.2.0 release: https://github.com/buildingSMART-Finland/InfraModel/releases/tag/4.2.0
- `inframodel.xsd`: https://github.com/buildingSMART-Finland/InfraModel/releases/download/4.2.0/inframodel.xsd
- `im.xsd`: https://github.com/buildingSMART-Finland/InfraModel/releases/download/4.2.0/im.xsd
- Käyttöohje PDF: https://github.com/buildingSMART-Finland/InfraModel/releases/download/4.2.0/Inframodel.pdf

Jos julkaistu skeema ja raw/dev-versio eroavat toisistaan, käytä julkaistua skeemaa.

## Tuetut versiot ja skeemahakemistot

Sovelluksen tulee tunnistaa ja tukea vähintään:

- InfraModel 4.0.4
- InfraModel 4.1
- InfraModel 4.2.0

Version mukaan paikalliset skeemat luetaan tästä rakenteesta:

```text
schemas/
  4.0.4/
    inframodel.xsd
    im.xsd
  4.1/
    inframodel.xsd
    im.xsd
  4.2.0/
    inframodel.xsd
    im.xsd
```

Älä oleta automaattisesti, että namespace muuttuu versionumeron mukaan. Tarkista namespace-logiikka julkaistuista skeemoista.

## Validoinnin tavoite

Validointi ei saa olla pelkkä XML well-formedness -tarkistus. Sen tulee mahdollisuuksien mukaan:

- lukea XML selaimessa,
- tunnistaa InfraModel-versio,
- tunnistaa sisältötyyppi,
- tarkistaa namespace ja skeemaan liittyviä asioita,
- tarkistaa XSD-pohjaisia sääntöjä version mukaan,
- tarkistaa käyttöohjeisiin perustuvia pakollisuuksia,
- raportoida virheet ja huomautukset selkeästi,
- antaa luotettava XML-polku ja tarvittaessa järkevä sijaintivihje.

Sisältötyyppikohtaisia tarkistuksia tulee tehdä vain kyseiselle sisältötyypille. Esimerkiksi `Alignments` ei ole pakollinen kaikille tiedostoille.

## Pintamallien erityistarkistukset

Pintamallien tarkistuksissa huomioi ainakin:

- `Surface`
- `Definition`
- `Pnts`
- `Faces`
- `surfaceCoding`
- `surfaceCodingDesc`
- `BreakLine`-elementtien `infraCoding`
- `terrainCoding`
- `terrainCodingDesc`

`BreakLine`-rakenteessa `IM_coding` voi esiintyä esimerkiksi näin:

- `BreakLine -> Feature -> Property`
- `BreakLine -> Features -> Feature -> Property`

Älä riko kumpaakaan rakennetta. `infraCoding`-arvon tulee olla kolminumeroinen, ja poikkeamasta tulee raportoida huomautus, jossa näkyy löydetty arvo.

`Surface`-elementin `surfaceCoding`-arvon tulee olla kuusinumeroinen, ja poikkeamasta tulee raportoida huomautus, jossa näkyy löydetty arvo.

## Raportointi

- Erottele virheet, huomautukset ja puhdas läpäisy selkeästi.
- Älä kerro tiedoston läpäisseen puhtaasti, jos huomautuksia löytyy.
- Suosi luotettavaa XML-polun raportointia.
- Näytä rivinumero vain, jos arvio on järkevä eikä selvästi harhaanjohtava.
- Sisällytä virheilmoituksiin tunnistavia attribuutteja, kuten `name`, `id`, `code`, `label` tai `desc`, jos ne ovat saatavilla.

## Usean tiedoston tuki

Sovelluksen tulee tukea usean `.xml`-tiedoston valintaa ja validointia yhdellä ajolla. Raportissa tulee näkyä:

- tiedostokohtaiset tulokset,
- koko ajon yhteenveto,
- tarkistettujen tiedostojen määrä,
- puhtaasti läpäisseiden tiedostojen määrä,
- huomautuksia sisältävien tiedostojen määrä,
- virheitä sisältävien tiedostojen määrä.

## Työskentelyohjeet

- Tarkista nykyinen toteutus reposta ennen muutoksia.
- Älä oleta, että aiemmassa keskustelussa mainitut muutokset ovat jo repossa.
- Älä palauta käyttäjälle tiedostoja, diffiä tai pitkiä koodisnippettejä keskusteluun, ellei käyttäjä erikseen pyydä.
- Kerro lopuksi lyhyesti, mitä muutettiin ja miksi.
