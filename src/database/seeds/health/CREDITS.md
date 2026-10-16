# Health demo photos

The demo doctors' portraits and the Health home's banners (`doctors-data.ts`:
`DEMO_PORTRAITS`, `DEMO_HEALTH_BANNERS`). All come from Unsplash and are free
under the [Unsplash License](https://unsplash.com/license): commercial use is
allowed, and neither permission nor attribution is required. They are credited
here as a courtesy and so they can be swapped out.

- **Fictional doctors.** Every demo doctor is made up. The portraits are stock
  photos of real people, matched to each doctor's gender, one person per doctor,
  and each profile's `about` ends with "(Demo profile: this doctor is
  fictional.)". Use them in demo and development data only. A real doctor's own
  upload always replaces the portrait.
- **Relevant photos.** Each banner photo shows what the banner opens. No brand,
  logo or readable name appears in any of them.
- **Delivery.** With Cloudinary keys the seed uploads each photo under the
  doctor's (or, for banners, the first demo doctor's) folder; without keys it
  stores the Unsplash URL (portraits face-cropped with `fit=facearea`).

## Portraits

| Doctor | Name | Photographer | Photo page |
|---|---|---|---|
| `dr01` | Sana Iqbal (female) | [Fotos](https://unsplash.com/@fotospk) | https://unsplash.com/photos/a-woman-in-a-white-coat-H9lg5Noj660 |
| `dr02` | Hamza Qureshi (male) | [vaibhav vivian](https://unsplash.com/@vrahim11) | https://unsplash.com/photos/a-man-with-a-stethoscope-standing-with-his-arms-crossed-3HIroMoyre8 |
| `dr03` | Mehwish Tariq (female) | [Jonathan Borba](https://unsplash.com/@jonathanborba) | https://unsplash.com/photos/a-woman-wearing-a-white-jacket-and-black-shirt-uBb_ZDIrquc |
| `dr04` | Usman Farooq (male) | [Usman Yousaf](https://unsplash.com/@usmanyousaf) | https://unsplash.com/photos/man-in-white-dress-shirt-wearing-black-framed-eyeglasses-pTrhfmj2jDA |
| `dr05` | Ayesha Siddiqui (female) | [Siednji Leon](https://unsplash.com/@siednji) | https://unsplash.com/photos/smiling-woman-in-white-long-sleeve-shirt-with-stethoscope-on-her-neck-lnlSIsiSjjc |
| `dr06` | Bilal Ahmed (male) | [SoyBreno](https://unsplash.com/@soybrenofotografia) | https://unsplash.com/photos/a-smiling-man-in-a-white-lab-coat-no7wWT_g9OA |
| `dr07` | Rabia Nadeem (female) | [Muhammad Faiz Zulkeflee](https://unsplash.com/@fzeo) | https://unsplash.com/photos/a-smiling-woman-wears-a-hijab-and-sunglasses-l1Db3NJJo9g |
| `dr08` | Nasreen Akhtar (female) | [Humberto Chávez](https://unsplash.com/@betoframe) | https://unsplash.com/photos/woman-standing-under-tree-FVh_yqLR9eA |
| `dr09` | Fatima Zaidi (female) | [Mufid Majnun](https://unsplash.com/@mufidpwt) | https://unsplash.com/photos/a-young-woman-wearing-a-white-hijab-and-smiling-J6kMThsc41M |
| `dr10` | Saima Rehman (female) | [Look Studio](https://unsplash.com/@lookphoto) | https://unsplash.com/photos/a-woman-in-a-white-shirt-is-holding-a-folder--_rTpmjX16A |
| `dr11` | Imran Shah (male) | [Dalton Ngangi](https://unsplash.com/@daltonngangi) | https://unsplash.com/photos/a-man-in-a-white-shirt-and-tie-posing-for-a-picture-ZCztndOWdjs |
| `dr12` | Hina Baig (female) | [Beatriz Mendez](https://unsplash.com/@beatrizmendez) | https://unsplash.com/photos/a-woman-in-blue-scrubs-with-glasses-smiles-_4xStiTXY1o |
| `dr13` | Kamran Malik (male) | [Fotos](https://unsplash.com/@fotospk) | https://unsplash.com/photos/a-doctor-holding-a-clipboard-heA9sNqsR7Y |
| `dr14` | Zainab Hassan (female) | [Othman El Marzak](https://unsplash.com/@othmanelmarzak) | https://unsplash.com/photos/a-close-up-of-a-person-with-a-smile-on-their-face-P4VXFXKyOQM |
| `dr15` | Faisal Raza (male) | [Fotos](https://unsplash.com/@fotospk) | https://unsplash.com/photos/a-man-holding-a-book-7A3PQx3hWdY |
| `dr16` | Tariq Mehmood (male) | [Frederick Medina](https://unsplash.com/@frederickjmedina) | https://unsplash.com/photos/a-man-with-a-stethoscope-on-his-neck-PZym9GEP5I0 |
| `dr17` | Sadia Kamal (female) | [Vitaly Gariev](https://unsplash.com/@silverkblack) | https://unsplash.com/photos/a-female-doctor-wearing-a-stethoscope-sits-at-her-desk-_zbqco3m7dA |
| `dr18` | Adeel Butt (male) | [mohamad azaam](https://unsplash.com/@mreke88) | https://unsplash.com/photos/a-man-in-a-lab-coat-standing-in-front-of-a-door-njTNSYPOaUE |
| `dr19` | Maria Khan (female) | [Ato Aikins](https://unsplash.com/@ato_aikins) | https://unsplash.com/photos/a-woman-wearing-a-white-coat-and-a-stethoscope-TPT4pevJEmQ |
| `dr20` | Asad Hussain (male) | [Muhammad Hicham](https://unsplash.com/@drfox_) | https://unsplash.com/photos/a-male-doctor-in-a-white-coat-and-tie-AZDVF4fEcY4 |
| `dr21` | Nida Javed (female) | [Kamal Hoseinianzade](https://unsplash.com/@teravis_sk) | https://unsplash.com/photos/a-person-sitting-in-a-chair-QdMjS_yNjkM |
| `dr22` | Omer Sheikh (male) | [David Akinwale](https://unsplash.com/@jayex2) | https://unsplash.com/photos/a-surgeon-in-blue-scrubs-stands-in-an-operating-room-mOSuHTOqZF8 |
| `dr23` | Shahid Anwar (male) | [Bruno Rodrigues](https://unsplash.com/@naosouogagliasso) | https://unsplash.com/photos/man-in-blue-crew-neck-t-shirt-wearing-blue-stethoscope-PZ041PgKsFE |
| `dr24` | Amna Yousaf (female) | [Eben Kassaye](https://unsplash.com/@ebengech) | https://unsplash.com/photos/a-woman-holding-a-stethoscope-in-her-right-hand-Z7TAIOQgjWA |
| `dr25` | Waqas Ali (male) | [Michael Dagonakis](https://unsplash.com/@mdagonakis) | https://unsplash.com/photos/man-in-black-dress-shirt-8qFzHvTuH3M |
| `dr26` | Sobia Naqvi (female) | [Fotos](https://unsplash.com/@fotospk) | https://unsplash.com/photos/a-woman-wearing-a-pink-head-scarf-v58ansqUXeM |
| `dr27` | Junaid Iqbal (male) | [Muhammad Hicham](https://unsplash.com/@drfox_) | https://unsplash.com/photos/a-man-in-a-green-scrub-suit-holding-a-toothbrush-PYxK4LNGn6E |
| `dr28` | Areeba Saleem (female) | [Bermix Studio](https://unsplash.com/@bermixstudio) | https://unsplash.com/photos/a-woman-in-a-white-lab-coat-pointing-at-something-ODM_VsTM2QQ |
| `dr29` | Haris Mirza (male) | [Nappy](https://unsplash.com/@nappystudio) | https://unsplash.com/photos/a-man-wearing-a-white-lab-coat-K6cnVC_0RuY |
| `dr30` | Lubna Aslam (female) | [Ike Ellyana](https://unsplash.com/@ikemotret20) | https://unsplash.com/photos/a-woman-in-a-lab-coat-smiles-outdoors-2G73aoMR-Go |

## Banners

| Banner | Photographer | Photo page |
|---|---|---|
| See a doctor by video today | [Vitaly Gariev](https://unsplash.com/@silverkblack) | https://unsplash.com/photos/doctor-consulting-patient-via-video-call-on-laptop-EVX9pt2dD1o |
| Skin and hair specialists | [Anna Keibalo](https://unsplash.com/@anyutakejbalo) | https://unsplash.com/photos/a-woman-in-a-white-shirt-and-purple-gloves-9vH-wWpUP3g |
| Not sure who to see? | [Vitaly Gariev](https://unsplash.com/@silverkblack) | https://unsplash.com/photos/two-women-talking-in-a-therapy-session-rG5elqddGzo |
| Gentle care for your child | [Ortopediatri Çocuk Ortopedi Akademisi](https://unsplash.com/@ortopediatri) | https://unsplash.com/photos/a-young-boy-in-a-wheelchair-holding-a-stuffed-animal-8JjW4xVwQqc |
| Your family's records, in one place | [CDC](https://unsplash.com/@cdc) | https://unsplash.com/photos/a-young-child-is-being-examined-by-a-doctor-fx9RJgZYRUE |
