"""Builds the plugin test score.

usage:
  python3 make_fixture.py voice2 <in.musicxml> <out.musicxml>
      Adds a second voice to the last bar (a half rest, then A2), so the
      bass there drops from voice 1's D3 to voice 2's A2 halfway.
  python3 make_fixture.py theorbo <bass.mscz> <out.mscz>
      Adds an empty 14-course theorbo part (standard staff + linked French
      tablature) as the target to realize into.
"""
import re
import sys
import zipfile

THEORBO_PART = """    <Part id="2">
      <Staff>
        <eid>jPCKk25BoXK_G4ixtGRMH1C</eid>
        <StaffType group="pitched">
          <name>stdNormal</name>
          </StaffType>
        <defaultClef>F</defaultClef>
        </Staff>
      <Staff>
        <eid>7jCBKsN+LBE_hLlPBmbjpmN</eid>
        <linkedTo>jPCKk25BoXK_G4ixtGRMH1C</linkedTo>
        <StaffType group="tablature">
          <name>tab6StrFrench</name>
          <lines>6</lines>
          <lineDistance>1.5</lineDistance>
          <stemless>1</stemless>
          <useNumbers>0</useNumbers>
          <upsideDown>0</upsideDown>
          <fretFontName>MuseScore Tab French</fretFontName>
          <onLines>0</onLines>
          </StaffType>
        <defaultClef>F</defaultClef>
        </Staff>
      <trackName>Theorbo</trackName>
      <Instrument id="theorbo-14-course">
        <longName>Theorbo</longName>
        <shortName>Thb.</shortName>
        <trackName>Theorbo</trackName>
        <minPitchP>31</minPitchP>
        <maxPitchP>71</maxPitchP>
        <minPitchA>31</minPitchA>
        <maxPitchA>71</maxPitchA>
        <instrumentId>pluck.theorbo</instrumentId>
        <clef>F</clef>
        <StringData>
          <frets>13</frets>
          <string open="1">31</string>
          <string open="1">33</string>
          <string open="1">35</string>
          <string open="1">36</string>
          <string open="1">38</string>
          <string open="1">40</string>
          <string open="1">41</string>
          <string open="1">43</string>
          <string>45</string>
          <string>50</string>
          <string>55</string>
          <string>59</string>
          <string>52</string>
          <string>57</string>
          </StringData>
        <Channel>
          <program value="25"/>
          <synti>Fluid</synti>
          </Channel>
        </Instrument>
      </Part>
"""


def empty_staff(staff_id, n_measures, key, sig_n, sig_d):
    measures = []
    for i in range(n_measures):
        head = ""
        if i == 0:
            head = (
                f"          <KeySig>\n            <concertKey>{key}</concertKey>\n            </KeySig>\n"
                f"          <TimeSig>\n            <sigN>{sig_n}</sigN>\n            <sigD>{sig_d}</sigD>\n            </TimeSig>\n"
            )
        measures.append(
            "      <Measure>\n        <voice>\n"
            + head
            + f"          <Rest>\n            <durationType>measure</durationType>\n"
            f"            <duration>{sig_n}/{sig_d}</duration>\n            </Rest>\n"
            "          </voice>\n        </Measure>\n"
        )
    return f'    <Staff id="{staff_id}">\n' + "".join(measures) + "      </Staff>\n"


def add_voice2(src, dst):
    xml = open(src).read()
    last = xml.rindex("</measure>")
    voice2 = (
        "      <backup><duration>96</duration></backup>\n"
        "      <note><rest/><duration>48</duration><voice>2</voice><type>half</type></note>\n"
        "      <note><pitch><step>A</step><octave>2</octave></pitch><duration>48</duration>"
        "<voice>2</voice><type>half</type></note>\n    "
    )
    open(dst, "w").write(xml[:last] + voice2 + xml[last:])


def add_theorbo(src, dst):
    with zipfile.ZipFile(src) as z:
        names = z.namelist()
        mscx_name = next(n for n in names if n.endswith(".mscx"))
        files = {n: z.read(n) for n in names}
    xml = files[mscx_name].decode()

    staff1 = re.search(r'<Staff id="1">(.*?)</Staff>', xml, re.S).group(1)
    n_measures = staff1.count("<Measure")
    key = re.search(r"<concertKey>(-?\d+)</concertKey>", staff1).group(1)
    sig_n = re.search(r"<sigN>(\d+)</sigN>", staff1).group(1)
    sig_d = re.search(r"<sigD>(\d+)</sigD>", staff1).group(1)

    last_part_end = xml.rindex("</Part>") + len("</Part>\n")
    xml = xml[:last_part_end] + THEORBO_PART + xml[last_part_end:]
    score_end = xml.rindex("\n", 0, xml.rindex("</Score>")) + 1
    xml = (
        xml[:score_end]
        + empty_staff(2, n_measures, key, sig_n, sig_d)
        + empty_staff(3, n_measures, key, sig_n, sig_d)
        + xml[score_end:]
    )
    files[mscx_name] = xml.encode()

    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, files[n])


if __name__ == "__main__":
    {"voice2": add_voice2, "theorbo": add_theorbo}[sys.argv[1]](sys.argv[2], sys.argv[3])
