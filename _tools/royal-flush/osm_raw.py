"""Reads the raw OSM files kept by osm_fetch.py (osm-<park>/raw-*.osm) into nodes, ways and relations."""
import os, glob, gzip, xml.etree.ElementTree as ET
def load(park):
    here = os.path.dirname(os.path.abspath(__file__))
    nodes, ways, rels = {}, {}, {}
    for f in sorted(glob.glob(os.path.join(here, 'osm-' + park, 'raw-*.osm*'))):
        for el in ET.parse(gzip.open(f) if f.endswith('.gz') else f).getroot():
            if el.get('id') is None: continue
            tags = {t.get('k'): t.get('v') for t in el.findall('tag')}
            i = int(el.get('id'))
            if el.tag == 'node': nodes[i] = (float(el.get('lat')), float(el.get('lon')), tags)
            elif el.tag == 'way': ways[i] = ([int(n.get('ref')) for n in el.findall('nd')], tags)
            elif el.tag == 'relation': rels[i] = ([(m.get('type'), int(m.get('ref')), m.get('role')) for m in el.findall('member')], tags)
    return nodes, ways, rels
