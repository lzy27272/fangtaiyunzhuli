import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('pruner',Path(__file__).with_name('prune-validated-raw.py'))
P=importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)


class EvidencePathTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.row={'evidence_id':'a'*64,'evidence_path':'raw/2026-01-01/'+'a'*64+'.json.enc',
          'tenant_id':'tenant','hotel_id':'hotel','source_id':'source','source_system':'YILIAN_CLOUD',
          'evidence_content_hash':'b'*64,'observed_at':'2026-01-01T00:00:00+00:00'}
        self.path=self.root/self.row['evidence_path']
        self.path.parent.mkdir(parents=True)
        self.envelope={'evidenceId':'a'*64,'tenantId':'tenant','hotelId':'hotel',
          'sourceId':'source','sourceSystem':'YILIAN_CLOUD','contentHash':'b'*64,
          'observedAt':'2026-01-01T08:00:00+08:00'}
        self.path.write_text(json.dumps(self.envelope))

    def test_same_instant_and_missing_after_interruption(self):
        self.assertGreater(P.checked_path(self.root,self.row)[1],0)
        self.path.unlink()
        self.assertEqual(P.checked_path(self.root,self.row)[1],0)

    def test_wrong_tenant_or_time_or_path_fails_closed(self):
        for key,value in [('tenant_id','other'),('observed_at','2026-01-02T00:00:00Z'),
                          ('evidence_path','../secret')]:
            with self.assertRaises(ValueError):
                P.checked_path(self.root,dict(self.row,**{key:value}))
        self.assertTrue(self.path.exists())

    def test_symlink_is_rejected(self):
        self.path.unlink()
        target=self.root/'elsewhere'
        target.write_text(json.dumps(self.envelope))
        self.path.symlink_to(target)
        with self.assertRaises(ValueError):
            P.checked_path(self.root,self.row)
        self.assertTrue(target.exists())


if __name__=='__main__':
    unittest.main()
